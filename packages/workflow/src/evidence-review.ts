import {
  type EvaluateReviewGateInput,
  type EvidenceMaterial,
  type ExecuteReviewInput,
  type ExecuteReviewResult,
  evaluateReviewGate,
  executeReview,
  type ReviewGateResult,
  type ReviewPorts,
} from "@lorelum/judge";
import { identityOf, type ValidationResult } from "@lorelum/judge-protocol";
import type { SandboxPort } from "@lorelum/judge-runtime";

export interface ApprovedEvidenceCheck {
  readonly id: string;
  readonly version: string | null;
  readonly environmentIdentity: string | null;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly readPaths: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type EvidenceCheckStatus =
  | "passed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "truncated"
  | "unavailable"
  | "not_started";
export interface EvidenceCheckResult extends ApprovedEvidenceCheck {
  readonly status: EvidenceCheckStatus;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly outputBytes: number;
}
export type EvidenceAuthorizationStage =
  | "before_check"
  | "after_check"
  | "before_review"
  | "after_review";
export interface EvidenceReviewInput {
  /** An independently created, frozen candidate copy, never the implementer's working tree. */
  readonly root: string;
  readonly candidateIdentity: string;
  /** Host-collected from this exact frozen copy under read and disclosure authorization. */
  readonly candidateEvidence?: readonly EvidenceMaterial[];
  readonly checks: readonly ApprovedEvidenceCheck[];
  readonly sandbox: SandboxPort;
  readonly signal: AbortSignal;
  /** Must revalidate current authority and reserve applicable budget before side effects. Throws on denial. */
  readonly authorize: (
    stage: EvidenceAuthorizationStage,
    check?: ApprovedEvidenceCheck,
  ) => void | Promise<void>;
  readonly review: {
    readonly input: Omit<ExecuteReviewInput, "evidence" | "signal">;
    /** Model/checker ports must themselves enforce per-call authorization, disclosure and budgets. */
    readonly ports: ReviewPorts;
    readonly gate?: Omit<EvaluateReviewGateInput, "execution" | "definition" | "instrument">;
  };
}
export interface EvidenceReviewResult {
  readonly candidateIdentity: string;
  readonly candidateEvidenceAvailable: boolean;
  readonly checks: readonly EvidenceCheckResult[];
  readonly review: ExecuteReviewResult | null;
  readonly gate: ValidationResult<ReviewGateResult> | null;
  readonly completeness: "complete" | "incomplete";
  readonly enforcement: "eligible" | "ineligible" | "unknown";
  readonly stopReason: string | null;
  readonly usage: { readonly commands: number; readonly outputBytes: number };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function pending(check: ApprovedEvidenceCheck): EvidenceCheckResult {
  return {
    ...check,
    status: "not_started",
    exitCode: null,
    stdout: "",
    stderr: "",
    outputBytes: 0,
  };
}

/** Runs checks against a read-only sandbox mount. The caller owns and authenticates the snapshot. */
export async function runEvidenceReview(input: EvidenceReviewInput): Promise<EvidenceReviewResult> {
  const candidateIdentity = input.candidateIdentity;
  const root = input.root;
  const fields = [
    "id",
    "version",
    "environmentIdentity",
    "executable",
    "args",
    "cwd",
    "readPaths",
    "timeoutMs",
    "maxOutputBytes",
  ];
  const checks = input.checks.map((check) => {
    if (
      check === null ||
      typeof check !== "object" ||
      Reflect.ownKeys(check).some((key) => typeof key !== "string" || !fields.includes(key)) ||
      fields.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(check, key);
        return descriptor === undefined || !("value" in descriptor);
      })
    ) {
      throw new Error("Invalid or unknown approved check fields");
    }
    return Object.freeze({
      id: check.id,
      version: check.version,
      environmentIdentity: check.environmentIdentity,
      executable: check.executable,
      args: Object.freeze([...check.args]),
      cwd: check.cwd,
      readPaths: Object.freeze([...check.readPaths]),
      timeoutMs: check.timeoutMs,
      maxOutputBytes: check.maxOutputBytes,
    });
  });
  const candidateEvidence =
    input.candidateEvidence?.map((material) => ({
      ...material,
      ...(material.conflictsWith === undefined
        ? {}
        : { conflictsWith: [...material.conflictsWith] }),
    })) ?? [];
  const results: EvidenceCheckResult[] = [];
  let stopReason: string | null = null;
  let commands = 0;
  let review: ExecuteReviewResult | null = null;
  let gate: ValidationResult<ReviewGateResult> | null = null;
  for (const check of checks) {
    if (stopReason !== null || input.signal.aborted) {
      stopReason ??= "cancelled";
      results.push(pending(check));
      continue;
    }
    try {
      await input.authorize("before_check", check);
      if (input.signal.aborted) throw new Error("cancelled");
    } catch (error) {
      stopReason = input.signal.aborted
        ? "cancelled"
        : `authorization or budget: ${message(error)}`;
      results.push(pending(check));
      continue;
    }
    commands++;
    try {
      const outcome = await input.sandbox.run({
        root,
        readPaths: check.readPaths,
        writablePaths: [],
        executable: check.executable,
        args: check.args,
        cwd: check.cwd,
        timeoutMs: check.timeoutMs,
        maxOutputBytes: check.maxOutputBytes,
        signal: input.signal,
      });
      const status: EvidenceCheckStatus =
        outcome.status === "completed"
          ? outcome.exitCode === 0
            ? "passed"
            : outcome.exitCode === null
              ? "unavailable"
              : "failed"
          : outcome.status === "failed"
            ? outcome.exitCode === null || outcome.exitCode === 0
              ? "unavailable"
              : "failed"
            : outcome.status;
      results.push({
        ...check,
        status,
        exitCode: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        outputBytes:
          Buffer.byteLength(outcome.stdout, "utf8") + Buffer.byteLength(outcome.stderr, "utf8"),
      });
    } catch (error) {
      results.push({
        ...pending(check),
        status: input.signal.aborted ? "cancelled" : "unavailable",
        error: message(error),
      });
    }
    try {
      await input.authorize("after_check", check);
      if (input.signal.aborted) throw new Error("cancelled");
    } catch (error) {
      stopReason = input.signal.aborted
        ? "cancelled"
        : `authorization or budget: ${message(error)}`;
    }
    if (results[results.length - 1]?.status === "cancelled") stopReason ??= "cancelled";
  }
  if (stopReason === null && !input.signal.aborted) {
    try {
      await input.authorize("before_review");
      if (input.signal.aborted) throw new Error("cancelled");
      const evidence = [
        ...candidateEvidence,
        ...results.map(
          (check, index): EvidenceMaterial =>
            check.status === "passed" || check.status === "failed"
              ? {
                  id: `check-${index + 1}`,
                  status: "present",
                  text: JSON.stringify({
                    candidateIdentity,
                    id: check.id,
                    version: check.version,
                    environmentIdentity: check.environmentIdentity,
                    executable: check.executable,
                    args: check.args,
                    cwd: check.cwd,
                    readPaths: check.readPaths,
                    timeoutMs: check.timeoutMs,
                    maxOutputBytes: check.maxOutputBytes,
                    status: check.status,
                    exitCode: check.exitCode,
                    stdout: check.stdout,
                    stderr: check.stderr,
                    ...(check.error === undefined ? {} : { error: check.error }),
                    outputBytes: check.outputBytes,
                  }),
                }
              : { id: `check-${index + 1}`, status: "unavailable" },
        ),
      ];
      review = await executeReview(
        { ...input.review.input, evidence, signal: input.signal },
        input.review.ports,
      );
      await input.authorize("after_review");
      if (input.signal.aborted) throw new Error("cancelled");
      if (review.ok && input.review.gate !== undefined) {
        gate = evaluateReviewGate({
          ...input.review.gate,
          execution: review.value.execution,
          definition: review.value.definition,
          instrument: review.value.instrument,
        });
      }
    } catch (error) {
      review = null;
      gate = null;
      stopReason = input.signal.aborted
        ? "cancelled"
        : `authorization, budget, or review: ${message(error)}`;
    }
  } else if (input.signal.aborted) stopReason ??= "cancelled";
  const completeness =
    results.length > 0 &&
    results.every((check) => check.status === "passed" || check.status === "failed")
      ? "complete"
      : "incomplete";
  const candidateEvidenceAvailable = candidateEvidence.some(
    (material) => material.status === "present" && typeof material.text === "string",
  );
  const enforcement =
    stopReason !== null ||
    completeness !== "complete" ||
    results.some((check) => check.status !== "passed")
      ? "ineligible"
      : gate?.ok
        ? gate.value.enforcementEligibility &&
          gate.value.decision.qualityOutcome === "pass" &&
          candidateEvidenceAvailable &&
          results.every((check) => check.version !== null && check.environmentIdentity !== null)
          ? "eligible"
          : "ineligible"
        : "unknown";
  return {
    candidateIdentity,
    candidateEvidenceAvailable,
    checks: results,
    review,
    gate,
    completeness,
    enforcement,
    stopReason,
    usage: { commands, outputBytes: results.reduce((sum, check) => sum + check.outputBytes, 0) },
  };
}

/** Compose a transparent report without promoting missing results into success. */
export function composeEvidenceReport<T extends Record<string, unknown>>(
  context: T,
  result: EvidenceReviewResult,
) {
  const reviewIdentity = result.review?.ok
    ? identityOf("workflow-review/v1", result.review.value)
    : null;
  const gateIdentity = result.gate?.ok
    ? identityOf("workflow-review-gate/v1", result.gate.value)
    : null;
  return {
    ...context,
    candidateIdentity: result.candidateIdentity,
    checks: result.checks,
    review: result.review,
    gate: result.gate,
    reviewIdentity: reviewIdentity?.ok ? reviewIdentity.identity : null,
    gateIdentity: gateIdentity?.ok ? gateIdentity.identity : null,
    quality: result.gate?.ok ? result.gate.value.decision.qualityOutcome : "unknown",
    completeness: result.completeness,
    enforcement: result.enforcement,
    usage: result.usage,
    stopReason: result.stopReason,
    unknowns: [
      ...(result.candidateEvidenceAvailable ? [] : ["candidate code evidence unavailable"]),
      ...result.checks
        .filter((check) => check.version === null || check.environmentIdentity === null)
        .map((check) => `check ${check.id}: version or environment identity unavailable`),
      ...result.checks
        .filter((check) => !["passed", "failed"].includes(check.status))
        .map((check) => `check ${check.id}: ${check.status}`),
      ...(result.review === null || !result.review.ok ? ["review unavailable"] : []),
      ...(result.gate === null || !result.gate.ok ? ["gate unavailable"] : []),
      ...(result.stopReason === null ? [] : [result.stopReason]),
    ],
  };
}
