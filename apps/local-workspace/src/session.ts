import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import type { ProgramChecker } from "@lorelum/judge";
import {
  type Identity,
  identityOf,
  validateWorkflowSessionEvent,
  type WorkflowSessionEvent,
} from "@lorelum/judge-protocol";
import {
  isModelPortError,
  type ModelGenerationConfig,
  type ModelPort,
} from "@lorelum/judge-runtime";
import {
  ControlledExecutionSession,
  closeWorkspaceReview,
  discoverWorkspace,
  type ExecutionPermission,
  type ExecutionProposal,
  type ImplementationResult,
  type PlanningInputs,
  PlanningSession,
  type VerificationConfiguration,
  verificationIdentity,
  type WorkspaceCandidateReview,
  type WorkspaceExclusion,
} from "@lorelum/judge-workflow";
import {
  describeEndpoint,
  OPENAI_CHAT_COMPLETIONS_PROTOCOL,
  PROVIDER_ADAPTER_VERSION,
  PROVIDER_LABEL,
} from "@lorelum/provider-openai-compatible";
import { createBubblewrapSandbox } from "@lorelum/runtime-bubblewrap";
import { createConfiguredModel, createOfflineModel } from "./model.js";

type HostModel = {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly config: ModelGenerationConfig;
};
type PendingDisclosure = {
  readonly identity: Identity;
  readonly instructions: string;
  readonly request: unknown;
  readonly recipient: string;
  readonly mode: string;
  authorized: boolean;
};
type ModelSelection = {
  readonly mode: "offline" | "configured";
  readonly recipient: string;
  readonly model: ModelPort;
  readonly config?: ModelGenerationConfig;
  readonly offline?: { readonly targetPath: string; readonly replacement: string };
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a nonempty string`);
  return value;
}
function json(value: unknown): void {
  const visit = (item: unknown): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
      return;
    }
    if (typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      for (const entry of Object.values(item as Record<string, unknown>)) visit(entry);
      return;
    }
    throw new Error("Only JSON values are accepted");
  };
  visit(value);
}

/** In-memory composition root. JSON proposals never become capabilities without a separate decision. */
export class SessionRouter {
  readonly #id = randomUUID();
  readonly #hostModel: HostModel | undefined;
  readonly #listeners = new Set<(event: unknown) => void>();
  #sequence = 0;
  #generation = 0;
  #workspace: WorkspaceCandidateReview | undefined;
  #sandboxAvailable: boolean | null = null;
  #model: ModelSelection | undefined;
  #plan: PlanningSession | undefined;
  #disclosure: PendingDisclosure | undefined;
  #execution: ControlledExecutionSession | undefined;
  #proposal: ExecutionProposal | undefined;
  #executionStatus:
    | "idle"
    | "proposed"
    | "authorized"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out" = "idle";
  #result: unknown = null;
  #controller: AbortController | undefined;
  #verification: unknown = null;
  #checker: ProgramChecker | undefined;
  readonly #actionIds = new Map<string, string>();
  readonly #actions = new Map<string, WorkflowSessionEvent>();
  readonly #actionDetails = new Map<string, { path?: string; commandIndex?: number }>();
  readonly #previousResults: unknown[] = [];
  #pendingDiff: string | null = null;
  #diffRevealed = false;

  constructor(options: { readonly configuredModel?: HostModel } = {}) {
    this.#hostModel = options.configuredModel
      ? structuredClone(options.configuredModel)
      : undefined;
  }

  #safe(value: unknown): unknown {
    const secret = this.#hostModel?.apiKey;
    if (typeof value === "string") return secret ? value.split(secret).join("[redacted]") : value;
    if (Array.isArray(value)) return value.map((item) => this.#safe(item));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.#safe(item)]),
      );
    return value;
  }
  #emit(
    kind: string,
    stage: string,
    status: string,
    internalId?: string,
    reason: WorkflowSessionEvent["reason"] = null,
    details?: { path?: string; commandIndex?: number },
  ): void {
    const key = `${kind}\0${internalId ?? kind}`;
    let actionId = this.#actionIds.get(key);
    if (!actionId) {
      actionId = randomUUID();
      this.#actionIds.set(key, actionId);
    }
    const actionKind: WorkflowSessionEvent["actionKind"] =
      kind === "read" ||
      kind === "write" ||
      kind === "command" ||
      kind === "model" ||
      kind === "check" ||
      kind === "review"
        ? kind
        : "unknown";
    const terminal = kind === "terminal";
    const projectedStatus =
      kind === "check" && stage === "result" && status === "completed"
        ? "passed"
        : status === "created"
          ? "completed"
          : status;
    const projectedStage = terminal
      ? "terminal"
      : (kind === "check" || kind === "review") &&
          stage === "result" &&
          (projectedStatus === "passed" ||
            projectedStatus === "failed" ||
            projectedStatus === "cancelled" ||
            projectedStatus === "timed_out" ||
            projectedStatus === "truncated" ||
            projectedStatus === "unavailable" ||
            projectedStatus === "unknown")
        ? "check"
        : stage;
    const event = {
      schema: "workflow-session-event/v1",
      sessionId: this.#id,
      sequence: this.#sequence + 1,
      stage: projectedStage,
      actionId: terminal ? null : actionId,
      actionKind: terminal ? null : actionKind,
      status: projectedStatus,
      reason,
    };
    const checked = validateWorkflowSessionEvent(event);
    if (!checked.ok) return;
    this.#sequence++;
    if (checked.value.actionId) this.#actions.set(checked.value.actionId, checked.value);
    if (checked.value.actionId && details) this.#actionDetails.set(checked.value.actionId, details);
    for (const listener of this.#listeners) {
      try {
        listener(checked.value);
      } catch {
        /* observers cannot affect authority */
      }
    }
  }
  subscribe(listener: (event: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  snapshot(): unknown {
    return this.#safe(
      structuredClone({
        sessionId: this.#id,
        sequence: this.#sequence,
        workspace: this.#workspace ?? null,
        diagnostics: {
          platform: process.platform,
          secureDiscovery: this.#workspace ? "passed" : "not_checked",
          bubblewrap:
            this.#sandboxAvailable === null
              ? "not_checked"
              : this.#sandboxAvailable
                ? "present"
                : "unavailable",
          isolation: "not_checked_until_execution",
        },
        model: this.#model
          ? {
              mode: this.#model.mode,
              recipient: this.#model.recipient,
              config: this.#model.config ?? null,
            }
          : null,
        plan: this.#plan?.review() ?? null,
        disclosure: this.#disclosure ?? null,
        execution: {
          status: this.#executionStatus,
          proposal: this.#proposal ?? null,
          verification: this.#verification,
          result: this.#result,
          diffAvailable: this.#pendingDiff !== null,
          diffRevealed: this.#diffRevealed,
          previousResults: this.#previousResults,
          actions: [...this.#actions.values()].map((event) => ({
            event,
            ...this.#actionDetails.get(event.actionId ?? ""),
          })),
        },
      }),
    );
  }
  #clearExecution(): void {
    if (this.#executionStatus === "running") this.#workspace = undefined;
    this.#controller?.abort();
    this.#execution?.revoke();
    this.#execution = undefined;
    if (this.#result !== null) this.#previousResults.push(this.#result);
    this.#proposal = undefined;
    this.#pendingDiff = null;
    this.#diffRevealed = false;
    this.#verification = null;
    this.#checker = undefined;
    this.#controller = undefined;
    this.#executionStatus = "idle";
    this.#result = null;
  }
  #invalidate(): void {
    this.#generation++;
    this.#controller?.abort();
    this.#clearExecution();
    this.#disclosure = undefined;
    this.#plan?.revokeModelDisclosure();
  }
  #requirePlan(): PlanningSession {
    if (!this.#plan) throw new Error("Create a planning session first");
    return this.#plan;
  }
  #requireModel(): ModelSelection {
    if (!this.#model) throw new Error("Select a model first");
    return this.#model;
  }
  #unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (!result.ok) {
      const error = result.error;
      if (
        error &&
        typeof error === "object" &&
        "kind" in error &&
        error.kind === "model" &&
        "error" in error &&
        isModelPortError(error.error)
      ) {
        throw new Error("Configured model request failed");
      }
      throw new Error(`Planning failed: ${JSON.stringify(this.#safe(error))}`);
    }
    return result.value;
  }
  #projectResult(
    result: ImplementationResult,
    permission: ExecutionPermission,
    terminalReason: WorkflowSessionEvent["reason"],
  ): unknown {
    const reason = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const lower = value
        .toLowerCase()
        .replace(/^authorization(?:, budget, or review| or budget):\s*/, "");
      if (lower.includes("permission revoked, expired, cancelled or plan changed")) {
        if (terminalReason === "expired") return "expired";
        if (terminalReason === "precondition_changed") return "precondition_changed";
        return "cancelled_or_revoked";
      }
      if (lower.includes("invalid authorization record")) return "verification_unavailable";
      if (lower.includes("expir")) return "expired";
      if (lower.includes("revok") || lower.includes("cancel") || lower.includes("abort"))
        return "cancelled_or_revoked";
      if (lower.includes("budget") || lower.includes("limit") || lower.includes("timed"))
        return "budget_or_timeout";
      if (
        lower.includes("workspace") ||
        lower.includes("precondition") ||
        lower.includes("changed")
      )
        return "precondition_changed";
      if (lower.includes("authoriz") || lower.includes("permission")) return "authorization_denied";
      if (lower.includes("review") || lower.includes("evidence") || lower.includes("verification"))
        return "verification_unavailable";
      return "error_or_unavailable";
    };
    const source =
      result.report && typeof result.report === "object"
        ? (result.report as Record<string, unknown>)
        : {};
    const report = {
      candidateIdentity:
        typeof source.candidateIdentity === "string" ? source.candidateIdentity : null,
      quality: typeof source.quality === "string" ? source.quality : "unknown",
      checks:
        result.evidence?.completeness ??
        (typeof source.checks === "string" ? source.checks : "incomplete"),
      enforcement: typeof source.enforcement === "string" ? source.enforcement : "unknown",
      diff: null,
      diffUnavailable:
        typeof source.diff === "string"
          ? "Explicit local diff reveal required"
          : "Candidate diff unavailable",
    };
    const evidence = result.evidence
      ? {
          candidateIdentity: result.evidence.candidateIdentity,
          candidateEvidenceAvailable: result.evidence.candidateEvidenceAvailable,
          checks: result.evidence.checks.map(({ error, stdout, stderr, ...check }) => ({
            ...check,
            error: reason(error),
            stdout: permission.disclosures.includes("command-output") ? stdout : null,
            stderr: permission.disclosures.includes("command-output") ? stderr : null,
          })),
          review: result.evidence.review?.ok ? result.evidence.review : null,
          gate: result.evidence.gate?.ok ? result.evidence.gate : null,
          completeness: result.evidence.completeness,
          enforcement: result.evidence.enforcement,
          stopReason: reason(result.evidence.stopReason),
          reviewStatus:
            result.evidence.review === null
              ? "unavailable"
              : result.evidence.review.ok
                ? "completed"
                : "failed",
          gateStatus:
            result.evidence.gate === null
              ? "unavailable"
              : result.evidence.gate.ok
                ? "completed"
                : "failed",
          usage: result.evidence.usage,
        }
      : null;
    return this.#safe({
      status: result.status,
      reason: result.status === "completed" ? null : reason(result.reason),
      workspaceRoot: result.workspaceRoot,
      usage: result.usage,
      evidence,
      report,
    });
  }
  async dispatch(action: string, payload: unknown): Promise<unknown> {
    try {
      json(payload);
      const data = object(payload);
      switch (action) {
        case "workspace.discover": {
          const root = text(data.root, "root");
          if (!Array.isArray(data.exclusions)) throw new Error("exclusions must be an array");
          this.#invalidate();
          const generation = this.#generation;
          this.#sandboxAvailable = null;
          const old = this.#workspace;
          this.#workspace = undefined;
          if (old) await closeWorkspaceReview(old);
          const review = await discoverWorkspace(root, data.exclusions as WorkspaceExclusion[]);
          if (generation !== this.#generation) {
            await closeWorkspaceReview(review);
            throw new Error("Workspace discovery was superseded");
          }
          const sandboxAvailable =
            process.platform === "linux" &&
            (await access("/usr/bin/bwrap").then(
              () => true,
              () => false,
            ));
          if (generation !== this.#generation) {
            await closeWorkspaceReview(review);
            throw new Error("Workspace discovery was superseded");
          }
          this.#sandboxAvailable = sandboxAvailable;
          this.#workspace = review;
          this.#emit("workspace", "result", "completed");
          break;
        }
        case "model.offline": {
          const targetPath = text(data.targetPath, "targetPath");
          if (typeof data.replacement !== "string") throw new Error("replacement must be a string");
          const checkDescription = text(data.checkDescription, "checkDescription");
          const model = createOfflineModel({
            targetPath,
            replacement: data.replacement,
            checkDescription,
          });
          this.#invalidate();
          this.#model = {
            mode: "offline",
            recipient: "offline (local deterministic model)",
            model,
            offline: { targetPath, replacement: data.replacement },
          };
          this.#emit("model", "result", "completed");
          break;
        }
        case "model.configured": {
          if (!this.#hostModel) throw new Error("No configured model is available from the host");
          const selected = createConfiguredModel(this.#hostModel);
          const secret = this.#hostModel.apiKey;
          const model: ModelPort = {
            generate(request) {
              if (secret && JSON.stringify(request.messages).includes(secret))
                throw new Error("Credential disclosure refused");
              return selected.model.generate(request);
            },
          };
          this.#invalidate();
          this.#model = { mode: "configured", ...selected, model };
          this.#emit("model", "result", "completed");
          break;
        }
        case "planning.create": {
          const id = text(data.id, "id");
          const plan = new PlanningSession(id, data.inputs as PlanningInputs);
          this.#invalidate();
          this.#plan = plan;
          this.#emit("planning", "result", "created");
          break;
        }
        case "planning.preview": {
          const plan = this.#requirePlan();
          const model = this.#requireModel();
          if (data.instructions !== undefined && typeof data.instructions !== "string")
            throw new Error("instructions must be a string");
          const instructions = (data.instructions as string | undefined) ?? "";
          const preview = plan.previewModelDisclosure(model.model, instructions, model.config);
          this.#disclosure = {
            ...preview,
            instructions,
            recipient: model.recipient,
            mode: model.mode,
            authorized: false,
          };
          this.#emit("disclosure", "proposed", "proposed");
          break;
        }
        case "planning.authorize": {
          const pending = this.#disclosure;
          const model = this.#requireModel();
          if (!pending || pending.identity !== data.identity)
            throw new Error("Disclosure preview does not match");
          this.#unwrap(this.#requirePlan().authorizeModelDisclosure(model.model, pending.identity));
          pending.authorized = true;
          this.#emit("disclosure", "authorization", "allowed");
          break;
        }
        case "planning.generate": {
          const pending = this.#disclosure;
          const model = this.#requireModel();
          const plan = this.#requirePlan();
          if (!pending?.authorized || pending.identity !== data.identity)
            throw new Error("Explicit authorization of this disclosure is required");
          this.#clearExecution();
          const generation = ++this.#generation;
          const controller = new AbortController();
          this.#controller = controller;
          this.#disclosure = undefined;
          this.#emit("planning", "started", "started");
          const result = await plan.generate({
            model: model.model,
            runId: randomUUID(),
            signal: controller.signal,
            disclosureIdentity: pending.identity,
            instructions: pending.instructions,
            ...(model.config ? { config: model.config } : {}),
          });
          if (generation !== this.#generation) throw new Error("Planning was superseded");
          this.#controller = undefined;
          this.#unwrap(result);
          this.#emit("planning", "result", "completed");
          break;
        }
        case "planning.confirm": {
          if (!Number.isSafeInteger(data.revision)) throw new Error("revision must be an integer");
          this.#unwrap(
            this.#requirePlan().confirm(
              text(data.identity, "identity") as Identity,
              data.revision as number,
            ),
          );
          this.#emit("planning", "authorization", "allowed");
          break;
        }
        case "planning.reject": {
          const plan = this.#requirePlan();
          const review = plan.review();
          if (!review) throw new Error("No plan to reject");
          this.#clearExecution();
          this.#unwrap(review.status === "confirmed" ? plan.revoke() : plan.invalidate());
          this.#disclosure = undefined;
          this.#emit("planning", "authorization", "denied");
          break;
        }
        case "planning.revokeDisclosure": {
          this.#invalidate();
          this.#emit("disclosure", "authorization", "denied");
          break;
        }
        case "execution.propose": {
          const plan = this.#requirePlan();
          const model = this.#requireModel();
          if (!this.#workspace) throw new Error("Discover a workspace first");
          if (!this.#sandboxAvailable) throw new Error("Linux bubblewrap is unavailable");
          this.#clearExecution();
          if (!this.#workspace) throw new Error("Discover a workspace first");
          const permissionData = object(data.permission);
          const permissionKeys = [
            "planIdentity",
            "planRevision",
            "workspaceIdentity",
            "readPaths",
            "commandReadPaths",
            "writePaths",
            "writablePaths",
            "commands",
            "disclosures",
            "modelRecipient",
            "limits",
            "expiresAt",
            "isolation",
            "verificationIdentity",
          ];
          if (Object.keys(permissionData).some((key) => !permissionKeys.includes(key)))
            throw new Error("Unsupported permission or resource limit");
          if (data.verification === undefined)
            throw new Error("Independent verification is required");
          let permission = data.permission as ExecutionPermission;
          if (!permission || permission.modelRecipient !== model.recipient)
            throw new Error("Model recipient does not match selected model");
          let verification: VerificationConfiguration | undefined;
          if (data.verification !== undefined) {
            const v = object(data.verification);
            if (!Array.isArray(v.checks)) throw new Error("checks must be an array");
            if (model.offline) {
              if (v.review !== undefined)
                throw new Error("Offline review uses only the fixed local checker");
              const offline = model.offline;
              if (
                permission.readPaths.length !== 1 ||
                permission.readPaths[0] !== offline.targetPath ||
                !permission.disclosures.includes("file-content")
              )
                throw new Error(
                  "Offline review requires file-content disclosure for exactly the selected file",
                );
              if (v.checks.length !== 1)
                throw new Error("Offline review requires exactly one independent check");
              const definition = {
                schema: "lorelum.judge.measurement-definition/v2",
                id: "offline-replacement-review",
                criteria: [
                  {
                    schema: "lorelum.judge.criterion/v1",
                    id: "offline-result",
                    kind: "contract",
                    description:
                      "Selected file exactly matches the supplied replacement and the independent check passes",
                    mandatory: true,
                    source: { origin: "contract", ref: "offline-replacement" },
                    anchors: [
                      { verdict: "met", description: "Both observations are satisfied" },
                      { verdict: "unmet", description: "An observation is not satisfied" },
                    ],
                    evidence: [
                      { evidenceId: "candidate-1", role: "primary" },
                      { evidenceId: "check-1", role: "primary" },
                    ],
                  },
                ],
                metadata: [
                  {
                    criterionId: "offline-result",
                    role: "decisive",
                    covers: [],
                    appliesTo: [plan.review()?.plan.task.taskClass ?? "code"],
                  },
                ],
              };
              const checker: ProgramChecker = ({ evidence, signal }) => {
                signal.throwIfAborted();
                const candidate = evidence.find((item) => item.id === "candidate-1");
                const check = evidence.find((item) => item.id === "check-1");
                let verdict = "insufficient";
                if (
                  candidate?.status === "present" &&
                  check?.status === "present" &&
                  typeof candidate.text === "string" &&
                  typeof check.text === "string"
                ) {
                  const file = JSON.parse(candidate.text) as { path?: unknown; content?: unknown };
                  const observed = JSON.parse(check.text) as {
                    status?: unknown;
                    exitCode?: unknown;
                  };
                  if (
                    file.path === offline.targetPath &&
                    typeof file.content === "string" &&
                    (observed.status === "passed" || observed.status === "failed")
                  )
                    verdict =
                      file.content === offline.replacement &&
                      observed.status === "passed" &&
                      observed.exitCode === 0
                        ? "met"
                        : "unmet";
                }
                return {
                  verdicts: [
                    {
                      schema: "lorelum.judge.verdict/v1",
                      criterionId: "offline-result",
                      verdict,
                      evidenceIds: verdict === "insufficient" ? [] : ["candidate-1", "check-1"],
                    },
                  ],
                };
              };
              this.#checker = checker;
              verification = {
                checks: v.checks as VerificationConfiguration["checks"],
                review: {
                  input: {
                    definition,
                    method: {
                      kind: "program",
                      checker: { id: "local-offline-replacement", version: "1" },
                    },
                  },
                  ports: { checker },
                },
              };
            } else {
              const config = model.config;
              if (!config || !this.#hostModel) throw new Error("Configured model is unavailable");
              const { model: modelName, ...decoding } = config;
              const method = {
                kind: "llm" as const,
                provider: {
                  protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL,
                  adapterVersion: PROVIDER_ADAPTER_VERSION,
                },
                endpointIdentity: describeEndpoint(this.#hostModel.endpoint).identity,
                model: { provider: PROVIDER_LABEL, name: modelName },
                ...(Object.keys(decoding).length ? { decoding } : {}),
              };
              const planned = plan.review()?.plan;
              if (!planned || v.checks.length === 0)
                throw new Error("At least one approved check is required");
              const criteria = v.checks.map((raw, index) => {
                const check = object(raw);
                const id = text(check.id, "check id");
                return {
                  schema: "lorelum.judge.criterion/v1",
                  id: `check-criterion-${index + 1}`,
                  kind: "contract",
                  description: `Independent check ${id} passes`,
                  mandatory: true,
                  source: { origin: "contract", ref: id },
                  anchors: [
                    { verdict: "met", description: "The independent check passed" },
                    { verdict: "unmet", description: "The independent check failed" },
                  ],
                  evidence: [{ evidenceId: `check-${index + 1}`, role: "primary" }],
                };
              });
              const definition = {
                schema: "lorelum.judge.measurement-definition/v2",
                id: "approved-checks-review",
                criteria,
                metadata: criteria.map((criterion) => ({
                  criterionId: criterion.id,
                  role: "decisive",
                  covers: [],
                  appliesTo: [planned.task.taskClass],
                })),
              };
              const review = v.review === undefined ? {} : object(v.review);
              const input = review.input === undefined ? {} : object(review.input);
              if (input.method !== undefined) {
                const requested = identityOf("local-review-method/v1", input.method);
                const actual = identityOf("local-review-method/v1", method);
                if (!requested.ok || !actual.ok || requested.identity !== actual.identity)
                  throw new Error("Review method differs from the host model");
              }
              verification = {
                checks: v.checks as VerificationConfiguration["checks"],
                review: {
                  input: {
                    ...input,
                    definition: input.definition ?? definition,
                    method,
                  } as VerificationConfiguration["review"]["input"],
                  ports: { model: model.model },
                  ...(review.gate === undefined
                    ? {}
                    : {
                        gate: review.gate as NonNullable<
                          VerificationConfiguration["review"]["gate"]
                        >,
                      }),
                },
              };
            }
            const identity = verificationIdentity(verification);
            if (
              permission.verificationIdentity !== undefined &&
              permission.verificationIdentity !== identity
            )
              throw new Error("Verification identity does not match configuration");
            permission = { ...permission, verificationIdentity: identity };
          }
          const execution = new ControlledExecutionSession(plan, this.#workspace);
          this.#proposal = execution.propose(permission, verification);
          this.#execution = execution;
          this.#verification = verification
            ? {
                checks: verification.checks,
                review: {
                  input: verification.review.input,
                  ...(verification.review.gate === undefined
                    ? {}
                    : { gate: verification.review.gate }),
                },
              }
            : null;
          this.#executionStatus = "proposed";
          this.#emit("execution", "proposed", "proposed");
          break;
        }
        case "execution.authorize": {
          if (!this.#execution || !this.#proposal || this.#executionStatus !== "proposed")
            throw new Error("No execution proposal");
          this.#execution.authorize(
            text(data.identity, "identity") as Identity,
            this.#requireModel().model,
            text(data.decisionRef, "decisionRef"),
            this.#checker,
          );
          this.#executionStatus = "authorized";
          this.#emit("execution", "authorization", "allowed");
          break;
        }
        case "execution.run": {
          if (!this.#execution || !this.#proposal || this.#executionStatus !== "authorized")
            throw new Error("Execution has not been authorized");
          const execution = this.#execution;
          const permission = this.#proposal.permission;
          const model = this.#requireModel();
          const generation = this.#generation;
          const controller = new AbortController();
          this.#controller = controller;
          this.#executionStatus = "running";
          this.#emit("execution", "started", "started");
          const runId = randomUUID();
          let terminalReason: WorkflowSessionEvent["reason"] = null;
          let terminalStatus: string | undefined;
          try {
            const result = await execution.implement({
              model: model.model,
              sandbox: createBubblewrapSandbox(),
              runId,
              signal: controller.signal,
              onEvent: (event) => {
                if (event.kind === "terminal") {
                  terminalReason = event.reason ?? null;
                  terminalStatus = event.status;
                  return;
                }
                const details: { path?: string; commandIndex?: number } = {};
                if (
                  event.path &&
                  ((event.kind === "read" && permission.readPaths.includes(event.path)) ||
                    (event.kind === "write" && permission.writePaths.includes(event.path)))
                )
                  details.path = event.path;
                if (
                  event.kind === "command" &&
                  event.commandIndex !== undefined &&
                  Number.isSafeInteger(event.commandIndex) &&
                  event.commandIndex >= 0 &&
                  event.commandIndex < permission.commands.length
                )
                  details.commandIndex = event.commandIndex;
                this.#emit(
                  event.kind,
                  event.stage,
                  event.status,
                  `${runId}:${event.id}`,
                  event.reason ?? null,
                  details,
                );
              },
            });
            const projected = this.#projectResult(result, permission, terminalReason);
            if (generation === this.#generation && this.#execution === execution) {
              const report = result.report;
              this.#pendingDiff =
                report &&
                typeof report === "object" &&
                "diff" in report &&
                typeof report.diff === "string"
                  ? report.diff
                  : null;
              this.#controller = undefined;
              this.#executionStatus = result.status;
              this.#result = projected;
              const consumedWorkspace = this.#workspace;
              this.#workspace = undefined;
              if (consumedWorkspace) await closeWorkspaceReview(consumedWorkspace);
            } else this.#previousResults.push(projected);
            if (terminalStatus)
              this.#emit("terminal", "terminal", terminalStatus, undefined, terminalReason);
          } catch (error) {
            if (this.#execution === execution) {
              this.#controller = undefined;
              this.#executionStatus = controller.signal.aborted ? "cancelled" : "failed";
              this.#result = { status: this.#executionStatus, report: null, evidence: null };
            }
            this.#emit(
              "terminal",
              "terminal",
              controller.signal.aborted ? "cancelled" : "failed",
              undefined,
              controller.signal.aborted ? "revoked" : "error",
            );
            throw error;
          }
          break;
        }
        case "execution.cancel": {
          if (!this.#execution || this.#executionStatus === "idle")
            throw new Error("No execution to cancel");
          this.#controller?.abort();
          this.#execution.revoke();
          if (this.#executionStatus !== "running") this.#executionStatus = "cancelled";
          this.#emit("execution", "authorization", "denied");
          break;
        }
        case "report.reveal": {
          if (
            data.allowFullCandidateDiff !== true ||
            this.#pendingDiff === null ||
            !this.#result ||
            typeof this.#result !== "object"
          )
            throw new Error("Explicit local diff approval is required");
          const result = this.#result as Record<string, unknown>;
          const report = object(result.report);
          this.#result = {
            ...result,
            report: { ...report, diff: this.#safe(this.#pendingDiff), diffUnavailable: null },
          };
          this.#diffRevealed = true;
          this.#emit("disclosure", "authorization", "allowed");
          break;
        }
        default:
          throw new Error("Unknown action");
      }
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const safe = [
        "Configured model request failed",
        "Secure source reading requires Linux openat2",
        "Project root must be absolute",
        "Project root must not traverse symbolic links",
        "Expected Git project root",
        "Invalid exclusion",
        "Unmerged Git index entries are unsupported",
        "Git index contains assume-unchanged or skip-worktree entries",
        "Project root changed during discovery",
        "Git metadata changed during discovery",
        "No configured model is available from the host",
        "Create a planning session first",
        "Linux bubblewrap is unavailable",
        "Select a model first",
        "Discover a workspace first",
        "Disclosure preview does not match",
        "Explicit authorization of this disclosure is required",
        "No execution proposal",
        "Execution has not been authorized",
        "No execution to cancel",
        "Unknown action",
        "Workspace discovery was superseded",
        "Planning was superseded",
        "Only JSON values are accepted",
        "Expected a JSON object",
        "Offline review requires file-content disclosure for exactly the selected file",
        "Offline review requires exactly one independent check",
        "Verification identity does not match configuration",
        "Unsupported permission or resource limit",
        "Unsupported or missing limits",
        "All supported limits must be positive safe integers",
        "Invalid or expired permission",
        "Independent verification is required",
        "At least one approved check is required",
        "Offline review uses only the fixed local checker",
        "Review method differs from the host model",
        "Explicit local diff approval is required",
        "Permission identity mismatch",
        "Plan or workspace is not current",
        "Plan is no longer eligible",
        "A real user decision reference is required",
        "Model recipient does not match selected model",
      ];
      return {
        ok: false,
        error: {
          kind: "rejected",
          message: safe.includes(message)
            ? message
            : "Action rejected: invalid input, unavailable prerequisite, or authorization mismatch",
        },
        state: this.snapshot(),
      };
    }
  }
}
