import { snapshot, type ValidationResult } from "@lorelum/judge-protocol";

import type { GateLocale } from "./gate.js";
import { advisoryPolicyFor } from "./gate.js";
import {
  type ExecuteReviewInput,
  type ExecuteReviewValue,
  prepareReview,
  type ReviewPorts,
  runPreparedReview,
} from "./review.js";
import {
  evaluateReviewGateContext,
  prepareReviewGateContext,
  type ReviewGateResult,
} from "./review-gate.js";
import { isRecord } from "./type-guards.js";

export interface ReviewGateRequest {
  readonly id?: string;
  /** A caller-supplied v2 policy. When omitted, an advisory policy is derived. */
  readonly policy?: unknown;
  readonly taskClass?: string;
  readonly evidenceShape?: string;
  readonly calibration?: unknown;
  readonly now?: string;
  readonly locale?: GateLocale;
}

export interface ReviewRequest extends ExecuteReviewInput {
  readonly gate?: ReviewGateRequest;
}

interface PreparedGate {
  readonly id?: string;
  readonly policy?: unknown;
  readonly taskClass?: string;
  readonly evidenceShape?: string;
  readonly calibration?: unknown;
  readonly now?: string;
  readonly locale?: GateLocale;
}

export interface ReviewValue {
  readonly review: ExecuteReviewValue;
  readonly gate: ReviewGateResult;
}

export type ReviewResult =
  | { readonly ok: true; readonly value: ReviewValue }
  | {
      readonly ok: false;
      readonly issues: readonly {
        readonly path: string;
        readonly code: string;
        readonly message: string;
      }[];
    };

function prepareGate(raw: unknown): ValidationResult<PreparedGate | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isRecord(raw)) {
    return {
      ok: false,
      issues: [{ path: "$.gate", code: "schema", message: "gate must be an object" }],
    };
  }
  const copied = snapshot({
    ...(raw.id === undefined ? {} : { id: raw.id }),
    ...(raw.policy === undefined ? {} : { policy: raw.policy }),
    ...(raw.taskClass === undefined ? {} : { taskClass: raw.taskClass }),
    ...(raw.evidenceShape === undefined ? {} : { evidenceShape: raw.evidenceShape }),
    ...(raw.calibration === undefined ? {} : { calibration: raw.calibration }),
    ...(raw.now === undefined ? {} : { now: raw.now }),
    ...(raw.locale === undefined ? {} : { locale: raw.locale }),
  });
  if (!isRecord(copied))
    return {
      ok: false,
      issues: [{ path: "$.gate", code: "schema", message: "gate must be an object" }],
    };
  if (copied.id !== undefined && (typeof copied.id !== "string" || copied.id.length === 0)) {
    return {
      ok: false,
      issues: [
        { path: "$.gate.id", code: "schema", message: "gate.id must be a non-empty string" },
      ],
    };
  }
  if (
    copied.taskClass !== undefined &&
    (typeof copied.taskClass !== "string" || copied.taskClass.length === 0)
  ) {
    return {
      ok: false,
      issues: [
        {
          path: "$.gate.taskClass",
          code: "schema",
          message: "gate.taskClass must be a non-empty string",
        },
      ],
    };
  }
  if (
    copied.evidenceShape !== undefined &&
    (typeof copied.evidenceShape !== "string" || copied.evidenceShape.length === 0)
  ) {
    return {
      ok: false,
      issues: [
        {
          path: "$.gate.evidenceShape",
          code: "schema",
          message: "gate.evidenceShape must be a non-empty string",
        },
      ],
    };
  }
  if (
    copied.now !== undefined &&
    (typeof copied.now !== "string" || !Number.isFinite(Date.parse(copied.now)))
  ) {
    return {
      ok: false,
      issues: [
        { path: "$.gate.now", code: "schema", message: "gate.now must be a parseable timestamp" },
      ],
    };
  }
  if (copied.locale !== undefined && copied.locale !== "zh-CN" && copied.locale !== "en-US") {
    return {
      ok: false,
      issues: [
        { path: "$.gate.locale", code: "schema", message: "gate.locale must be zh-CN or en-US" },
      ],
    };
  }
  const locale = copied.locale === "zh-CN" || copied.locale === "en-US" ? copied.locale : undefined;
  return {
    ok: true,
    value: {
      ...(copied.id === undefined ? {} : { id: copied.id }),
      ...(copied.policy === undefined ? {} : { policy: copied.policy }),
      ...(copied.taskClass === undefined ? {} : { taskClass: copied.taskClass }),
      ...(copied.evidenceShape === undefined ? {} : { evidenceShape: copied.evidenceShape }),
      ...(copied.calibration === undefined ? {} : { calibration: copied.calibration }),
      ...(copied.now === undefined ? {} : { now: copied.now }),
      ...(locale === undefined ? {} : { locale }),
    },
  };
}

/**
 * One-call review entry: execute once by default, then project the result onto
 * gate semantics. Without a caller policy the projection uses an advisory policy,
 * so the caller still learns whether the result can automatically gate delivery.
 */
export async function review(input: ReviewRequest, ports: ReviewPorts): Promise<ReviewResult> {
  let preparedGate: ValidationResult<PreparedGate | undefined>;
  try {
    preparedGate = prepareGate(input.gate);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "$.gate",
          code: "schema",
          message: `gate input could not be read: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
      ],
    };
  }
  if (!preparedGate.ok) return preparedGate;

  const preparedReview = prepareReview(input, ports);
  if (!preparedReview.ok) return preparedReview;
  const gate = preparedGate.value;
  const taskClass = gate?.taskClass ?? "default";
  const evidenceShape = gate?.evidenceShape ?? "default";
  const policy =
    gate?.policy ??
    advisoryPolicyFor(
      preparedReview.value.definition,
      preparedReview.value.definitionIdentity,
      preparedReview.value.instrumentIdentity,
      taskClass,
      evidenceShape,
    );
  const context = prepareReviewGateContext({
    id: gate?.id ?? "review-decision",
    taskClass,
    evidenceShape,
    definition: preparedReview.value.definition,
    instrument: preparedReview.value.instrument,
    policy,
    ...(gate?.calibration === undefined ? {} : { calibration: gate.calibration }),
    now: gate?.now ?? new Date().toISOString(),
    ...(gate?.locale === undefined ? {} : { locale: gate.locale }),
  });
  if (!context.ok) {
    return {
      ok: false,
      issues: context.issues.map((issue) => ({
        ...issue,
        path: issue.path.startsWith("$.policy")
          ? `$.gate.policy${issue.path.slice("$.policy".length)}`
          : issue.path.startsWith("$.definition") || issue.path.startsWith("$.instrument")
            ? issue.path
            : `$.gate.policy${issue.path.slice(1)}`,
      })),
    };
  }

  const signal =
    typeof input === "object" &&
    input !== null &&
    "signal" in input &&
    input.signal instanceof AbortSignal
      ? input.signal
      : undefined;
  const reviewed = await runPreparedReview(preparedReview.value, ports, signal);
  if (!reviewed.ok) return reviewed;
  const evaluated = evaluateReviewGateContext(
    { ...context.value, id: gate?.id ?? `decision:${reviewed.value.execution.id}` },
    reviewed.value.execution,
  );
  if (!evaluated.ok) return evaluated;
  return { ok: true, value: { review: reviewed.value, gate: evaluated.value } };
}
