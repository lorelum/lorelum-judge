import {
  type GatePolicyV2,
  measurementDefinitionIdentityV2,
  snapshot,
  validateGatePolicyV2,
  validateMeasurementDefinitionV2,
} from "@lorelum/judge-protocol";

import { isRecord } from "./type-guards.js";

type AcceptedVerdicts = GatePolicyV2["criteria"][number]["acceptedVerdicts"];

import type { GateLocale } from "./gate.js";
import {
  type ExecuteReviewInput,
  type ExecuteReviewValue,
  executeReview,
  type ReviewPorts,
} from "./review.js";
import { evaluateReviewGate, type ReviewGateResult } from "./review-gate.js";

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

function gateIssue(message: string): ReviewResult {
  return { ok: false, issues: [{ path: "$.gate", code: "schema", message }] };
}

function prepareGate(raw: unknown, definition: unknown): PreparedGate | undefined | ReviewResult {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return gateIssue("gate must be an object");
  const calibration = raw.calibration;
  const copied = snapshot({
    ...(raw.id === undefined ? {} : { id: raw.id }),
    ...(raw.policy === undefined ? {} : { policy: raw.policy }),
    ...(raw.taskClass === undefined ? {} : { taskClass: raw.taskClass }),
    ...(raw.evidenceShape === undefined ? {} : { evidenceShape: raw.evidenceShape }),
    ...(raw.now === undefined ? {} : { now: raw.now }),
    ...(raw.locale === undefined ? {} : { locale: raw.locale }),
  });
  if (!isRecord(copied)) return gateIssue("gate must be an object");
  if (copied.id !== undefined && (typeof copied.id !== "string" || copied.id.length === 0)) {
    return gateIssue("gate.id must be a non-empty string");
  }
  if (
    copied.taskClass !== undefined &&
    (typeof copied.taskClass !== "string" || copied.taskClass.length === 0)
  ) {
    return gateIssue("gate.taskClass must be a non-empty string");
  }
  if (
    copied.evidenceShape !== undefined &&
    (typeof copied.evidenceShape !== "string" || copied.evidenceShape.length === 0)
  ) {
    return gateIssue("gate.evidenceShape must be a non-empty string");
  }
  if (
    copied.now !== undefined &&
    (typeof copied.now !== "string" || !Number.isFinite(Date.parse(copied.now)))
  ) {
    return gateIssue("gate.now must be a parseable timestamp");
  }
  if (copied.locale !== undefined && copied.locale !== "zh-CN" && copied.locale !== "en-US") {
    return gateIssue("gate.locale must be zh-CN or en-US");
  }
  if (copied.policy !== undefined) {
    const policy = validateGatePolicyV2(copied.policy);
    if (!policy.ok) {
      return {
        ok: false,
        issues: policy.issues.map((issue) => ({
          ...issue,
          path: `$.gate.policy${issue.path.slice(1)}`,
        })),
      };
    }
    const parsedDefinition = validateMeasurementDefinitionV2(definition);
    if (parsedDefinition.ok) {
      const definitionId = measurementDefinitionIdentityV2(parsedDefinition.value);
      if (definitionId.ok && policy.value.definitionIdentity !== definitionId.identity) {
        return {
          ok: false,
          issues: [
            {
              path: "$.gate.policy.definitionIdentity",
              code: "identity_mismatch",
              message: "gate policy is for a different definition",
            },
          ],
        };
      }
    }
  }
  const locale = copied.locale === "zh-CN" || copied.locale === "en-US" ? copied.locale : undefined;
  return {
    ...(copied.id === undefined ? {} : { id: copied.id }),
    ...(copied.policy === undefined ? {} : { policy: copied.policy }),
    ...(copied.taskClass === undefined ? {} : { taskClass: copied.taskClass }),
    ...(copied.evidenceShape === undefined ? {} : { evidenceShape: copied.evidenceShape }),
    ...(calibration === undefined ? {} : { calibration }),
    ...(copied.now === undefined ? {} : { now: copied.now }),
    ...(locale === undefined ? {} : { locale }),
  };
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

function defaultAccepted(kind: "contract" | "quality" | "comparison"): AcceptedVerdicts {
  if (kind === "contract") return ["met"];
  if (kind === "quality") return ["strong", "adequate"];
  return ["better", "equivalent"];
}

function advisoryPolicy(
  review: ExecuteReviewValue,
  request: ReviewGateRequest | undefined,
): GatePolicyV2 {
  const definition = review.definition;
  const criterionIds = definition.criteria.map((criterion) => criterion.id);
  const firstId = criterionIds[0];
  const rules = definition.criteria.map((criterion): GatePolicyV2["criteria"][number] => ({
    criterionId: criterion.id,
    acceptedVerdicts: defaultAccepted(criterion.kind),
    requiredCaseKinds: ["decisive", "equivalent", "anti"],
  }));
  const firstRule = rules[0];
  if (firstId === undefined || firstRule === undefined) {
    throw new Error("a review definition has at least one criterion");
  }
  const policy: GatePolicyV2 = {
    schema: "lorelum.judge.gate-policy/v2",
    id: `advisory:${definition.id}`,
    definitionIdentity: review.execution.definitionIdentity,
    instrumentIdentity: review.execution.instrumentIdentity,
    scopes: [
      {
        taskClass: request?.taskClass ?? "default",
        evidenceShape: request?.evidenceShape ?? "default",
        criterionIds: [firstId, ...criterionIds.slice(1)],
      },
    ],
    criteria: [firstRule, ...rules.slice(1)],
    minimumAgreement: 1,
    minimumGroupsPerCaseKind: 1,
    confidenceLevel: 0.95,
    maximumFalseAcceptRate: 0.05,
    maximumFalseRejectRate: 0.1,
    maximumAbstentionRate: 0.2,
    maximumDisagreementRate: 0.2,
    onUncalibrated: "diagnostic",
  };
  return policy;
}

/**
 * One-call review entry: execute once by default, then project the result onto
 * gate semantics. Without a caller policy the projection uses an advisory policy,
 * so the caller still learns whether the result can automatically gate delivery.
 */
export async function review(input: ReviewRequest, ports: ReviewPorts): Promise<ReviewResult> {
  let prepared: PreparedGate | undefined | ReviewResult;
  try {
    prepared = prepareGate(input.gate, input.definition);
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
  if (prepared !== undefined && "ok" in prepared) return prepared;
  const reviewed = await executeReview(input, ports);
  if (!reviewed.ok) return reviewed;
  const gate = prepared;
  const evaluated = evaluateReviewGate({
    id: gate?.id ?? `decision:${reviewed.value.execution.id}`,
    taskClass: gate?.taskClass ?? "default",
    evidenceShape: gate?.evidenceShape ?? "default",
    execution: reviewed.value.execution,
    definition: reviewed.value.definition,
    instrument: reviewed.value.instrument,
    policy: gate?.policy ?? advisoryPolicy(reviewed.value, gate),
    ...(gate?.calibration === undefined ? {} : { calibration: gate.calibration }),
    now: gate?.now ?? new Date().toISOString(),
    ...(gate?.locale === undefined ? {} : { locale: gate.locale }),
  });
  if (!evaluated.ok) return evaluated;
  return { ok: true, value: { review: reviewed.value, gate: evaluated.value } };
}
