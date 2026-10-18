import type { GatePolicyV2 } from "@lorelum/judge-protocol";

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
  const reviewed = await executeReview(input, ports);
  if (!reviewed.ok) return reviewed;
  const gate = input.gate;
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
