import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ProgramChecker } from "@lorelum/judge";
import { type Identity, identityOf } from "@lorelum/judge-protocol";
import type { ModelPort, SandboxPort, SandboxRunResult } from "@lorelum/judge-runtime";
import { writeAuthorizedFile } from "./controlled-write.js";
import {
  composeEvidenceReport,
  type EvidenceReviewInput,
  type EvidenceReviewResult,
  runEvidenceReview,
} from "./evidence-review.js";
import {
  type ApprovedVerificationRecord,
  captureVerificationRecord,
  createExecutionRecords,
} from "./execution-records.js";
import {
  type BaselineFile,
  collectFailureDiff,
  freezeCandidate,
  renderCandidateDiff,
} from "./frozen-candidate.js";
import type { PlanningSession } from "./index.js";
import {
  cloneWorkspaceReview,
  closeWorkspaceReview,
  createWorkspaceSnapshot,
  type WorkspaceCandidateReview,
} from "./workspace.js";

export interface ExecutionCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}
export interface ExecutionLimits {
  readonly totalTimeMs: number;
  readonly commandTimeMs: number;
  readonly modelCalls: number;
  readonly actions: number;
  readonly commands: number;
  readonly outputBytes: number;
}
export interface ExecutionPermission {
  readonly planIdentity: Identity;
  readonly planRevision: number;
  readonly workspaceIdentity: string;
  readonly readPaths: readonly string[];
  /** Scope granted to sandboxed commands, distinct from model file reads. */
  readonly commandReadPaths: readonly string[];
  readonly writePaths: readonly string[];
  /** Directories that approved commands may modify, independently of model writePaths. */
  readonly writablePaths: readonly string[];
  readonly commands: readonly ExecutionCommand[];
  /** Explicit host disclosure decisions: plan, file-content and command-output. */
  readonly disclosures: readonly ("plan" | "file-content" | "command-output" | "review")[];
  /** Host-displayed recipient identity; the model object is independently bound at authorization. */
  readonly modelRecipient: string;
  readonly limits: ExecutionLimits;
  readonly expiresAt: number;
  readonly isolation: "bubblewrap-no-network";
  readonly verificationIdentity?: Identity;
}
export interface ExecutionProposal {
  readonly permission: ExecutionPermission;
  readonly identity: Identity;
}
export interface ExecutionUsage {
  totalTimeMs: number;
  commandTimeMs: number;
  modelCalls: number;
  actions: number;
  commands: number;
  outputBytes: number;
}
export interface ImplementationResult {
  readonly status: "completed" | "failed" | "cancelled" | "timed_out";
  readonly reason: string;
  readonly workspaceRoot: string | null;
  readonly usage: ExecutionUsage;
  readonly observations: readonly unknown[];
  readonly evidence?: EvidenceReviewResult;
  readonly records?: unknown;
  readonly report?: unknown;
}
export interface VerificationConfiguration {
  readonly checks: EvidenceReviewInput["checks"];
  readonly review: EvidenceReviewInput["review"];
}

/** Identity of the exact check and judge configuration presented for host approval. */
export function verificationIdentity(configuration: VerificationConfiguration): Identity {
  return id({
    checks: configuration.checks,
    input: configuration.review.input,
    ...(configuration.review.gate === undefined ? {} : { gate: configuration.review.gate }),
  });
}
function copyVerification(value: VerificationConfiguration): VerificationConfiguration {
  const gate = value.review.gate;
  const gateData =
    gate === undefined
      ? undefined
      : {
          id: gate.id,
          taskClass: gate.taskClass,
          evidenceShape: gate.evidenceShape,
          policy: gate.policy,
          now: gate.now,
          ...(gate.locale === undefined ? {} : { locale: gate.locale }),
        };
  const copied = structuredClone({
    checks: value.checks,
    input: value.review.input,
    ...(gateData === undefined ? {} : { gate: gateData }),
  });
  return {
    checks: copied.checks,
    review: {
      input: copied.input,
      ports: { ...value.review.ports },
      ...(copied.gate === undefined
        ? {}
        : {
            gate: {
              ...copied.gate,
              ...(gate?.calibration === undefined ? {} : { calibration: gate.calibration }),
            },
          }),
    },
  };
}
function safePath(path: string, dot = false): boolean {
  if (dot && path === ".") return true;
  return (
    !!path &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  );
}
function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
function hash(data: Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}
function id(value: unknown): Identity {
  const result = identityOf("workflow-host-permission/v1", value);
  if (!result.ok) throw new Error("Cannot identify permission");
  return result.identity;
}
function validateCommandShape(permission: ExecutionPermission): void {
  const commands = Object.getOwnPropertyDescriptor(permission, "commands");
  if (!commands || !("value" in commands) || !Array.isArray(commands.value))
    throw new Error("Commands must be an explicit data array");
  for (const command of commands.value) {
    if (!command || typeof command !== "object" || Array.isArray(command))
      throw new Error("Invalid approved command");
    const keys = Reflect.ownKeys(command);
    if (
      keys.length !== 3 ||
      keys.some((key) => typeof key !== "string" || !["executable", "args", "cwd"].includes(key))
    )
      throw new Error("Approved command contains unknown fields");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(command, key);
      if (!descriptor || !("value" in descriptor))
        throw new Error("Approved command fields must be data");
    }
    const args = Object.getOwnPropertyDescriptor(command, "args")?.value;
    if (!Array.isArray(args) || Reflect.ownKeys(args).length !== args.length + 1)
      throw new Error("Approved command args must be a dense data array");
    for (let index = 0; index < args.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(args, String(index));
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string")
        throw new Error("Approved command args must be strings");
    }
  }
}
function validate(permission: ExecutionPermission): void {
  if (
    !Number.isSafeInteger(permission.planRevision) ||
    permission.planRevision < 1 ||
    !Number.isFinite(permission.expiresAt) ||
    permission.expiresAt <= Date.now() ||
    permission.isolation !== "bubblewrap-no-network" ||
    !permission.modelRecipient.trim()
  )
    throw new Error("Invalid or expired permission");
  const limitNames = [
    "totalTimeMs",
    "commandTimeMs",
    "modelCalls",
    "actions",
    "commands",
    "outputBytes",
  ] as const;
  if (Object.keys(permission.limits).length !== limitNames.length)
    throw new Error("Unsupported or missing limits");
  for (const name of limitNames) {
    const value = permission.limits[name];
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("All supported limits must be positive safe integers");
  }
  for (const path of [
    ...permission.readPaths,
    ...permission.writePaths,
    ...permission.writablePaths,
  ]) {
    if (!safePath(path)) throw new Error("Invalid authorized path");
  }
  if (permission.commandReadPaths.some((path) => !safePath(path, true)))
    throw new Error("Invalid command read path");
  for (const command of permission.commands) {
    if (
      Object.keys(command).length !== 3 ||
      Object.keys(command).some((key) => !["executable", "args", "cwd"].includes(key)) ||
      typeof command.executable !== "string" ||
      command.executable.includes("\0") ||
      typeof command.cwd !== "string" ||
      !isAbsolute(command.executable) ||
      !safePath(command.cwd, true) ||
      !Array.isArray(command.args) ||
      command.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
    ) {
      throw new Error("Invalid approved command");
    }
  }
  if (
    permission.disclosures.some(
      (item) => !["plan", "file-content", "command-output", "review"].includes(item),
    )
  )
    throw new Error("Unsupported disclosure");
}
async function checkedPath(root: string, path: string, allowMissing: boolean): Promise<string> {
  if (!safePath(path)) throw new Error("Invalid action path");
  const parts = path.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    try {
      const entry = await lstat(current);
      if (
        entry.isSymbolicLink() ||
        (i === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())
      )
        throw new Error("Unsupported path type");
    } catch (error) {
      if (
        allowMissing &&
        i === parts.length - 1 &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        break;
      throw error;
    }
  }
  if ((await realpath(root)) !== root) throw new Error("Snapshot root changed");
  return current;
}

/** Host-owned, single-use permission. Serialized proposals are never capabilities. */
export class ControlledExecutionSession {
  readonly #plan: PlanningSession;
  readonly #review: WorkspaceCandidateReview;
  #proposal: ExecutionProposal | undefined;
  #verification: VerificationConfiguration | undefined;
  #verificationRecord: ApprovedVerificationRecord | undefined;
  #approved = false;
  #recipient: ModelPort | undefined;
  #checker: ProgramChecker | undefined;
  #decisionRef: string | undefined;
  #used = false;
  #controller = new AbortController();
  constructor(plan: PlanningSession, workspace: WorkspaceCandidateReview) {
    this.#plan = plan;
    this.#review = cloneWorkspaceReview(workspace);
  }
  propose(
    permission: ExecutionPermission,
    verification?: VerificationConfiguration,
  ): ExecutionProposal {
    this.revoke();
    if (this.#used) throw new Error("Execution session is single-use");
    validateCommandShape(permission);
    const copy = structuredClone(permission);
    validate(copy);
    const copiedVerification = verification ? copyVerification(verification) : undefined;
    if (
      (copiedVerification ? verificationIdentity(copiedVerification) : undefined) !==
      copy.verificationIdentity
    )
      throw new Error("Verification configuration does not match permission");
    this.#verification = copiedVerification;
    this.#verificationRecord = copiedVerification
      ? captureVerificationRecord(copiedVerification)
      : undefined;
    if (
      copy.workspaceIdentity !== this.#review.identity ||
      !this.#plan.isEligible(copy.planIdentity, copy.planRevision)
    )
      throw new Error("Plan or workspace is not current");
    this.#controller = new AbortController();
    this.#proposal = { permission: copy, identity: id(copy) };
    return structuredClone(this.#proposal);
  }
  /** Only a trusted host may call this after an independent explicit user decision. */
  authorize(
    identity: Identity,
    recipient: ModelPort,
    decisionRef: string,
    checker?: ProgramChecker,
  ): void {
    if (!this.#proposal || this.#proposal.identity !== identity || this.#used)
      throw new Error("Permission identity mismatch");
    if (!decisionRef.trim()) throw new Error("A real user decision reference is required");
    this.#approved = false;
    this.#recipient = undefined;
    this.#checker = undefined;
    this.#decisionRef = undefined;
    validate(this.#proposal.permission);
    if (
      !this.#plan.isEligible(
        this.#proposal.permission.planIdentity,
        this.#proposal.permission.planRevision,
      )
    )
      throw new Error("Plan is no longer eligible");
    const review = this.#verification?.review;
    if (review?.input.method.kind === "program") {
      if (!checker || review.ports.checker !== checker || review.ports.model !== undefined)
        throw new Error("Program checker requires explicit authorization of the exact checker");
    } else if (checker !== undefined || review?.ports.checker !== undefined) {
      throw new Error("Checker is not authorized for this review method");
    }
    this.#approved = true;
    this.#recipient = recipient;
    this.#checker = checker;
    this.#decisionRef = decisionRef;
  }
  revoke(): void {
    this.#approved = false;
    this.#recipient = undefined;
    this.#checker = undefined;
    this.#decisionRef = undefined;
    this.#proposal = undefined;
    this.#verification = undefined;
    this.#verificationRecord = undefined;
    this.#controller.abort();
  }
  async implement(options: {
    readonly model: ModelPort;
    readonly sandbox: SandboxPort;
    readonly runId: string;
    readonly signal: AbortSignal;
  }): Promise<ImplementationResult> {
    if (this.#used || !this.#proposal || !this.#approved || options.model !== this.#recipient)
      throw new Error("Independent permission and matching disclosure recipient required");
    this.#used = true;
    const permission = this.#proposal.permission;
    const decisionRef = this.#decisionRef;
    const planSnapshot = this.#plan.review();
    const usage: ExecutionUsage = {
      totalTimeMs: 0,
      commandTimeMs: 0,
      modelCalls: 0,
      actions: 0,
      commands: 0,
      outputBytes: 0,
    };
    const startedAt = performance.now();
    const observations: unknown[] = [];
    let root: string | null = null;
    const baseline = new Map<string, BaselineFile>();
    let baselineComplete = false;
    let runnerRoot: string | undefined;
    const verification = this.#verification;
    const authorizedChecker = this.#checker;
    const verificationRecord = this.#verificationRecord;
    let collectedEvidence: EvidenceReviewResult | undefined;
    let timedOut = false;
    const abort = () => this.#controller.abort();
    const unsubscribe = this.#plan.subscribeInvalidation(abort);
    options.signal.addEventListener("abort", abort, { once: true });
    const untilExpiry = Math.max(0, permission.expiresAt - Date.now());
    const timer = setTimeout(
      () => {
        timedOut = untilExpiry >= permission.limits.totalTimeMs;
        abort();
      },
      Math.min(permission.limits.totalTimeMs, untilExpiry),
    );
    const guard = () => {
      if (performance.now() - startedAt >= permission.limits.totalTimeMs) {
        timedOut = true;
        abort();
      }
      if (
        options.signal.aborted ||
        this.#controller.signal.aborted ||
        !this.#approved ||
        Date.now() >= permission.expiresAt ||
        !this.#plan.isEligible(permission.planIdentity, permission.planRevision)
      ) {
        abort();
        throw new Error("Permission revoked, expired, cancelled or plan changed");
      }
      if (verification && permission.verificationIdentity !== verificationIdentity(verification)) {
        abort();
        throw new Error("Verification configuration changed");
      }
    };
    const reserve = (
      key: "modelCalls" | "actions" | "commands" | "outputBytes",
      amount: number,
    ) => {
      guard();
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        usage[key] + amount > permission.limits[key]
      )
        throw new Error(`${key} budget exceeded`);
      usage[key] += amount;
    };
    try {
      guard();
      if (!permission.disclosures.includes("plan"))
        throw new Error("Plan disclosure not authorized");
      if (verification && permission.verificationIdentity !== verificationIdentity(verification))
        throw new Error("Approved verification configuration changed");
      if (!verification && permission.verificationIdentity)
        throw new Error("Approved verification configuration is missing");
      if (
        verification &&
        (permission.verificationIdentity !== verificationIdentity(verification) ||
          !permission.disclosures.includes("review") ||
          !permission.disclosures.includes("command-output") ||
          (verification.review.input.method.kind === "llm"
            ? verification.review.ports.model !== options.model ||
              verification.review.ports.checker !== undefined
            : !authorizedChecker ||
              verification.review.ports.checker !== authorizedChecker ||
              verification.review.ports.model !== undefined))
      )
        throw new Error("Review configuration or disclosure not authorized");
      const plan = planSnapshot;
      if (!plan || !decisionRef) throw new Error("Missing plan or user decision");
      if (
        verification &&
        (verification.checks.length !== plan.plan.checks.length ||
          new Set(verification.checks.map((check) => check.id)).size !==
            verification.checks.length ||
          verification.checks.some(
            (check) => !plan.plan.checks.some((planned) => planned.id === check.id),
          ))
      ) {
        throw new Error("Verification checks do not match the confirmed plan");
      }
      root = await createWorkspaceSnapshot(this.#review, guard, this.#controller.signal);
      guard();
      for (const file of this.#review.candidates) {
        if (file.status !== "present") continue;
        guard();
        const data = await readFile(await checkedPath(root, file.path, false));
        guard();
        if (
          hash(data) !== file.contentIdentity ||
          file.mode === null ||
          ((await lstat(await checkedPath(root, file.path, false))).mode & 0o777) !== file.mode
        )
          throw new Error("Private snapshot differs from reviewed workspace");
        guard();
        baseline.set(file.path, { data, mode: file.mode });
      }
      baselineComplete = true;
      for (;;) {
        const prompt = JSON.stringify({
          plan: plan.plan,
          observations,
          instruction:
            "Return JSON action: {type:'read',path}, {type:'write',path,expectedIdentity,content}, {type:'command',index}, or {type:'done'}. Writes require the sha256 identity of the old bytes, or null for a new file. Commands are selected only by index from the host-approved list.",
          commands: permission.commands,
        });
        reserve("modelCalls", 1);
        const response = await options.model.generate({
          runId: options.runId,
          stepIndex: usage.modelCalls - 1,
          signal: this.#controller.signal,
          tools: [],
          messages: [{ role: "user", content: prompt }],
        });
        guard();
        const raw =
          response.kind === "structured"
            ? JSON.stringify(response.value)
            : response.kind === "message"
              ? response.content
              : "";
        reserve("outputBytes", bytes(raw));
        const action: unknown = JSON.parse(raw);
        if (!action || typeof action !== "object" || Array.isArray(action))
          throw new Error("Invalid action");
        reserve("actions", 1);
        const item = action as Record<string, unknown>;
        if (item.type === "done") {
          if (!verification) throw new Error("Independent verification was not authorized");
          const frozen = await freezeCandidate(root, guard);
          runnerRoot = frozen.root;
          const candidateEvidence: { id: string; status: "present"; text: string }[] = [];
          if (permission.disclosures.includes("file-content")) {
            for (const file of frozen.files) {
              if (!permission.readPaths.includes(file.path)) continue;
              guard();
              const data = await readFile(await checkedPath(frozen.root, file.path, false));
              guard();
              if (hash(data) !== file.identity) throw new Error("Frozen candidate changed");
              candidateEvidence.push({
                id: `candidate-${candidateEvidence.length + 1}`,
                status: "present",
                text: JSON.stringify({
                  path: file.path,
                  identity: file.identity,
                  content: new TextDecoder("utf-8", { fatal: true }).decode(data),
                }),
              });
            }
          }
          const reviewModel: ModelPort = {
            generate: async (request) => {
              guard();
              reserve("modelCalls", 1);
              const response = await options.model.generate({
                runId: request.runId,
                stepIndex: request.stepIndex,
                messages: request.messages,
                tools: request.tools,
                ...(request.config === undefined ? {} : { config: request.config }),
                signal: AbortSignal.any([request.signal, this.#controller.signal]),
              });
              guard();
              reserve("outputBytes", bytes(JSON.stringify(response)));
              return response;
            },
          };
          const reviewChecker: ProgramChecker | undefined = authorizedChecker
            ? async (input) => {
                guard();
                if (this.#checker !== authorizedChecker)
                  throw new Error("Program checker authorization changed");
                const result = await authorizedChecker({
                  ...input,
                  signal: AbortSignal.any([input.signal, this.#controller.signal]),
                });
                guard();
                if (this.#checker !== authorizedChecker)
                  throw new Error("Program checker authorization changed");
                return result;
              }
            : undefined;
          const evidence = await runEvidenceReview({
            root: frozen.root,
            candidateIdentity: frozen.identity,
            candidateEvidence,
            checks: verification.checks,
            signal: this.#controller.signal,
            sandbox: {
              run: async (request) => {
                guard();
                const started = performance.now();
                let result: SandboxRunResult;
                try {
                  result = await options.sandbox.run(request);
                } finally {
                  usage.commandTimeMs += Math.ceil(performance.now() - started);
                }
                const outputSize = bytes(result.stdout) + bytes(result.stderr);
                if (usage.outputBytes + outputSize > permission.limits.outputBytes)
                  throw new Error("outputBytes budget exceeded");
                usage.outputBytes += outputSize;
                return result;
              },
            },
            authorize: (stage, check) => {
              guard();
              if (stage === "before_check") {
                if (
                  !check ||
                  !permission.commands.some(
                    (command) =>
                      command.executable === check.executable &&
                      command.cwd === check.cwd &&
                      JSON.stringify(command.args) === JSON.stringify(check.args),
                  ) ||
                  JSON.stringify(check.readPaths) !== JSON.stringify(permission.commandReadPaths) ||
                  check.timeoutMs > permission.limits.commandTimeMs ||
                  check.maxOutputBytes > permission.limits.outputBytes - usage.outputBytes
                )
                  throw new Error("Check is not authorized or exceeds budget");
                reserve("commands", 1);
              }
            },
            review: {
              ...verification.review,
              ports:
                verification.review.input.method.kind === "program"
                  ? {
                      ...verification.review.ports,
                      ...(reviewChecker ? { checker: reviewChecker } : {}),
                    }
                  : { ...verification.review.ports, model: reviewModel },
            },
          });
          collectedEvidence = evidence;
          guard();
          const changes = frozen.files
            .filter(
              (file) =>
                !this.#review.candidates.some(
                  (old) =>
                    old.path === file.path &&
                    old.contentIdentity === file.identity &&
                    old.mode === file.mode,
                ),
            )
            .map((file) => file.path);
          const deleted = this.#review.candidates
            .filter(
              (old) =>
                old.status === "present" && !frozen.files.some((file) => file.path === old.path),
            )
            .map((old) => old.path);
          const diff = await renderCandidateDiff(baseline, frozen, guard);
          const report = composeEvidenceReport(
            {
              planIdentity: permission.planIdentity,
              planRevision: permission.planRevision,
              workspaceIdentity: permission.workspaceIdentity,
              diff,
              changes,
              deleted,
              totalUsage: usage,
            },
            evidence,
          );
          usage.totalTimeMs = Math.ceil(performance.now() - startedAt);
          if (!decisionRef) throw new Error("Missing host decision reference");
          const records = createExecutionRecords({
            plan: plan.plan,
            workspace: this.#review,
            permission,
            decisionRef,
            verification,
            ...(verificationRecord ? { verificationRecord } : {}),
            evidence,
            usage,
            diff,
            status: evidence.stopReason ? "failed" : "completed",
            stopReason: evidence.stopReason ?? "Independent review completed",
            reviewIdentity: report.reviewIdentity,
            gateIdentity: report.gateIdentity,
            quality:
              report.quality === "pass" || report.quality === "fail" ? report.quality : "unknown",
            unknowns: report.unknowns,
          });
          return {
            status: evidence.stopReason ? "failed" : "completed",
            reason: evidence.stopReason ?? "Independent review completed",
            workspaceRoot: root,
            usage,
            observations,
            evidence,
            report,
            records,
          };
        }
        if (item.type === "read") {
          if (
            typeof item.path !== "string" ||
            !permission.readPaths.includes(item.path) ||
            !permission.disclosures.includes("file-content")
          )
            throw new Error("Read or disclosure not authorized");
          const file = await checkedPath(root, item.path, false);
          guard();
          const data = await readFile(file);
          guard();
          observations.push({
            type: "read",
            path: item.path,
            identity: hash(data),
            content: new TextDecoder("utf-8", { fatal: true }).decode(data),
          });
        } else if (item.type === "write") {
          if (
            typeof item.path !== "string" ||
            !permission.writePaths.includes(item.path) ||
            typeof item.content !== "string" ||
            !(typeof item.expectedIdentity === "string" || item.expectedIdentity === null)
          )
            throw new Error("Write not authorized");
          const rootPath = root;
          const path = item.path;
          const file = await checkedPath(rootPath, path, true);
          const content = Buffer.from(item.content, "utf8");
          await writeAuthorizedFile({
            target: file,
            expectedIdentity: item.expectedIdentity,
            content,
            guard,
            signal: this.#controller.signal,
            resolveTarget: () => checkedPath(rootPath, path, true),
          });
          guard();
          observations.push({ type: "write", path: item.path, identity: hash(content) });
        } else if (item.type === "command") {
          if (
            typeof item.index !== "number" ||
            !Number.isSafeInteger(item.index) ||
            !permission.disclosures.includes("command-output")
          )
            throw new Error("Command or disclosure not authorized");
          const command = permission.commands[item.index];
          if (!command) throw new Error("Command not authorized");
          reserve("commands", 1);
          const remaining = permission.limits.outputBytes - usage.outputBytes;
          if (remaining <= 0) throw new Error("outputBytes budget exceeded");
          const started = performance.now();
          let result: SandboxRunResult;
          try {
            result = await options.sandbox.run({
              root,
              readPaths: permission.commandReadPaths,
              writablePaths: permission.writablePaths,
              executable: command.executable,
              args: command.args,
              cwd: command.cwd,
              timeoutMs: permission.limits.commandTimeMs,
              maxOutputBytes: remaining,
              signal: this.#controller.signal,
            });
          } finally {
            usage.commandTimeMs += Math.ceil(performance.now() - started);
          }
          const outputSize = bytes(result.stdout) + bytes(result.stderr);
          if (usage.outputBytes + outputSize > permission.limits.outputBytes)
            throw new Error("outputBytes budget exceeded");
          usage.outputBytes += outputSize;
          observations.push({ type: "command", index: item.index, ...result });
          guard();
          if (result.status !== "completed" || result.exitCode !== 0)
            throw new Error(`Command ${result.status}`);
        } else throw new Error("Unsupported model action");
      }
    } catch (error) {
      usage.totalTimeMs = Math.ceil(performance.now() - startedAt);
      const status = timedOut
        ? "timed_out"
        : this.#controller.signal.aborted || options.signal.aborted
          ? "cancelled"
          : "failed";
      const reason =
        error instanceof Error ? error.message || "Unknown failure" : "Unknown failure";
      const failureEvidence: EvidenceReviewResult | undefined = collectedEvidence
        ? {
            ...collectedEvidence,
            review: null,
            gate: null,
            enforcement: "ineligible",
            stopReason: reason,
          }
        : undefined;
      let failureDiff: string | undefined;
      let diffFailure: string | undefined;
      if (root && baselineComplete) {
        try {
          // Reporting has its own small local-only deadline and byte/entry budgets.
          failureDiff = await collectFailureDiff(root, baseline);
        } catch (diffError) {
          diffFailure =
            diffError instanceof Error ? diffError.message : "unknown inspection failure";
        }
      }
      usage.totalTimeMs = Math.ceil(performance.now() - startedAt);
      let records: unknown;
      let failureReport: unknown;
      let recordFailure: string | undefined;
      if (planSnapshot && decisionRef) {
        try {
          const chain = createExecutionRecords({
            plan: planSnapshot.plan,
            workspace: this.#review,
            permission,
            decisionRef,
            ...(verification ? { verification } : {}),
            ...(verificationRecord ? { verificationRecord } : {}),
            ...(failureEvidence ? { evidence: failureEvidence } : {}),
            status,
            stopReason: reason,
            usage,
            diff: failureDiff ?? "",
            reviewIdentity: null,
            gateIdentity: null,
            quality: "unknown",
            unknowns: [
              ...(failureDiff === undefined
                ? [`diff unavailable${diffFailure ? `: ${diffFailure}` : ""}`]
                : []),
              ...(failureEvidence
                ? []
                : ["candidate snapshot unavailable", "independent checks not completed"]),
              "review unavailable",
              reason,
            ],
          });
          records = chain;
          failureReport = chain.report;
        } catch (recordError) {
          recordFailure =
            recordError instanceof Error ? recordError.message : "Unknown record error";
        }
      }
      return {
        status,
        reason: recordFailure ? `${reason}; record unavailable: ${recordFailure}` : reason,
        workspaceRoot: root,
        usage,
        observations,
        ...(failureEvidence ? { evidence: failureEvidence } : {}),
        ...(failureReport
          ? { report: failureReport }
          : failureDiff !== undefined
            ? { report: { diff: failureDiff, unknowns: ["protocol record unavailable"] } }
            : {}),
        ...(records ? { records } : {}),
      };
    } finally {
      clearTimeout(timer);
      unsubscribe();
      options.signal.removeEventListener("abort", abort);
      try {
        if (runnerRoot) await rm(runnerRoot, { recursive: true, force: true });
      } finally {
        await closeWorkspaceReview(this.#review);
        this.#approved = false;
      }
    }
  }
}
