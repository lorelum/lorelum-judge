import {
  type GateDecision,
  type GatePolicyV2,
  type InstrumentProfileV2,
  instrumentRepetitions,
  type MeasurementDefinitionV2,
  type ReviewExecution,
  type ValidationResult,
  validateGateDecision,
  validateGatePolicyForV2,
  validateInstrumentV2,
  validateMeasurementDefinitionV2,
  validateReviewExecution,
} from "@lorelum/judge-protocol";

import { isVerifiedCalibration } from "./calibration.js";
import { evaluateGate, type GateLocale, type GateObservation, qualityOutcomeFor } from "./gate.js";
import {
  type ReviewGateReason,
  renderReviewExplanation,
  renderSummary,
} from "./gate-presentation.js";
import { type ReviewCompleteness, reviewCompleteness } from "./review.js";
import { isRecord } from "./type-guards.js";

export interface EvaluateReviewGateInput {
  readonly id: string;
  readonly taskClass: string;
  readonly evidenceShape: string;
  readonly execution: unknown;
  readonly definition: unknown;
  readonly instrument: unknown;
  readonly policy: unknown;
  readonly calibration?: unknown;
  readonly now: string;
  readonly locale?: GateLocale;
}

export interface ReviewGateContext {
  readonly id: string;
  readonly taskClass: string;
  readonly evidenceShape: string;
  readonly definition: MeasurementDefinitionV2;
  readonly instrument: InstrumentProfileV2;
  readonly policy: GatePolicyV2;
  readonly calibration?: unknown;
  readonly now: string;
  readonly locale?: GateLocale;
}

export interface ReviewGateResult {
  readonly decision: GateDecision;
  readonly completeness: ReviewCompleteness;
  readonly enforcementEligibility: boolean;
  readonly reasons: readonly ReviewGateReason[];
  readonly explanation: string;
}

const PARAMETER_KEYS = ["temperature", "topP", "maxTokens", "seed"] as const;

function parameterValue(value: unknown, key: string): number | undefined {
  if (!isRecord(value) || !(key in value)) return undefined;
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

function sameParameters(left: unknown, right: unknown): boolean {
  return PARAMETER_KEYS.every((key) => parameterValue(left, key) === parameterValue(right, key));
}

/** The execution validator has already established every field this projection needs. */
function observationsFor(execution: ReviewExecution): GateObservation[] {
  const observations: GateObservation[] = [];
  for (const attempt of execution.attempts) {
    if (attempt.status === "not_started") continue;
    if (attempt.status === "cancelled") {
      observations.push({
        id: attempt.id,
        status: "failed",
        failureCategory: "execution",
        message: "the attempt was cancelled",
      });
      continue;
    }
    if (attempt.status === "failed") {
      if (attempt.failure === undefined) throw new Error("validated failed attempt has no failure");
      observations.push({
        id: attempt.id,
        status: "failed",
        failureCategory: attempt.failure.category,
        message: attempt.failure.message,
        ...(attempt.evidenceBundle === undefined ? {} : { evidenceBundle: attempt.evidenceBundle }),
      });
      continue;
    }
    if (attempt.evidenceBundle === undefined) {
      throw new Error("validated assessed attempt has no evidence bundle");
    }
    if (attempt.status === "completed") {
      if (attempt.run === undefined) throw new Error("validated completed attempt has no run");
      observations.push({
        id: attempt.id,
        status: "completed",
        run: attempt.run,
        evidenceBundle: attempt.evidenceBundle,
      });
      continue;
    }
    if (attempt.verdicts === undefined) {
      throw new Error("validated partial attempt has no verdicts");
    }
    observations.push({
      id: attempt.id,
      status: "partial",
      verdicts: attempt.verdicts,
      evidenceBundle: attempt.evidenceBundle,
    });
  }
  return observations;
}

function requestIssues(
  execution: ReviewExecution,
  instrument: InstrumentProfileV2,
): { readonly reasons: readonly ReviewGateReason[]; readonly blocking: boolean } {
  if (instrument.method.kind !== "llm") {
    return { reasons: [], blocking: false };
  }
  const method = instrument.method;
  const reasons = new Set<ReviewGateReason>();
  for (const attempt of execution.attempts) {
    if (attempt.llm === undefined) {
      if (attempt.status !== "not_started") reasons.add("response_metadata_missing");
      continue;
    }
    const request = attempt.llm.request;
    if (
      request.model !== method.model.name ||
      request.modelProvider !== method.model.provider ||
      request.endpointIdentity !== method.endpointIdentity ||
      !sameParameters(request.parameters, method.decoding)
    ) {
      reasons.add("request_mismatch");
    }
    if (request.promptIdentity === undefined) {
      reasons.add("prompt_identity_unknown");
    } else if (request.promptIdentity !== method.promptIdentity) {
      reasons.add("prompt_identity_conflict");
    }
    if (attempt.status === "completed") {
      if (request.renderIdentity === undefined || attempt.run?.renderIdentity === undefined) {
        reasons.add("render_identity_conflict");
      } else if (attempt.run.renderIdentity !== request.renderIdentity) {
        reasons.add("render_identity_conflict");
      }
    }
    const response = attempt.llm.response;
    if (response === undefined) {
      reasons.add("response_metadata_missing");
      continue;
    }
    if (response.model === undefined) {
      reasons.add("response_model_unknown");
    } else if (response.model !== request.model) {
      reasons.add("response_model_conflict");
    }
    if (response.finishReason === undefined) {
      reasons.add("finish_reason_unknown");
    }
  }
  return { reasons: [...reasons], blocking: reasons.size > 0 };
}

/** Validates gate inputs once, before any checker or model call. */
export function prepareReviewGateContext(
  input: Omit<EvaluateReviewGateInput, "execution">,
): ValidationResult<ReviewGateContext> {
  const definition = validateMeasurementDefinitionV2(input.definition);
  const instrument = validateInstrumentV2(input.instrument);
  const policy = validateGatePolicyForV2(input.policy, input.definition, input.instrument);
  if (!definition.ok || !instrument.ok || !policy.ok) {
    return {
      ok: false,
      issues: [
        ...(!definition.ok ? definition.issues : []),
        ...(!instrument.ok ? instrument.issues : []),
        ...(!policy.ok ? policy.issues : []),
      ],
    };
  }
  return {
    ok: true,
    value: {
      id: input.id,
      taskClass: input.taskClass,
      evidenceShape: input.evidenceShape,
      definition: definition.value,
      instrument: instrument.value,
      policy: policy.value,
      ...(input.calibration === undefined ? {} : { calibration: input.calibration }),
      now: input.now,
      ...(input.locale === undefined ? {} : { locale: input.locale }),
    },
  };
}

/**
 * Projects a ReviewExecution onto #9 gate semantics. Legal partial findings stay
 * visible; no verdict is invented for a missing item. Incomplete executions can
 * fail (a supported required failure is kept) but never pass or gain enforcement.
 */
export function evaluateReviewGateContext(
  context: ReviewGateContext,
  executionInput: unknown,
): ValidationResult<ReviewGateResult> {
  try {
    const execution = validateReviewExecution(
      executionInput,
      context.definition,
      context.instrument,
    );
    if (!execution.ok) return execution;
    if (execution.value.plannedCount !== instrumentRepetitions(context.instrument)) {
      return {
        ok: false,
        issues: [
          {
            path: "$.execution.plannedCount",
            code: "report_mismatch",
            message: "the execution plan and the instrument repetition count differ",
          },
        ],
      };
    }
    const requests = requestIssues(execution.value, context.instrument);
    const reasons = new Set<ReviewGateReason>(requests.reasons);
    if (context.calibration === undefined) {
      reasons.add("calibration_unavailable");
    } else if (!isVerifiedCalibration(context.calibration)) {
      reasons.add("calibration_unverified");
    }
    const completeness = reviewCompleteness(execution.value);
    reasons.add(`execution_${completeness}`);
    const gate = evaluateGate({
      id: context.id,
      definition: context.definition,
      instrument: context.instrument,
      policy: context.policy,
      taskClass: context.taskClass,
      evidenceShape: context.evidenceShape,
      observations: observationsFor(execution.value),
      ...(context.calibration === undefined ? {} : { calibration: context.calibration }),
      now: context.now,
      ...(context.locale === undefined ? {} : { locale: context.locale }),
    });
    if (!gate.ok) return gate;
    const resolved = gate.value;
    const downgrade =
      (completeness !== "complete" || requests.blocking) && resolved.executionMode === "enforced";
    const executionMode: GateDecision["executionMode"] = downgrade
      ? context.policy.onUncalibrated
      : resolved.executionMode;
    const findings =
      completeness === "complete"
        ? resolved.findings
        : resolved.findings.map((finding) =>
            finding.outcome === "fail" || finding.reason === "not_applicable"
              ? finding
              : { ...finding, outcome: "indeterminate" as const },
          );
    const finalQuality = qualityOutcomeFor(findings, completeness !== "complete");
    const decision: GateDecision = {
      ...resolved,
      qualityOutcome: finalQuality,
      executionMode,
      findings,
      summary: renderSummary(finalQuality, executionMode, context.locale ?? "zh-CN"),
    };
    const checked = validateGateDecision(decision);
    if (!checked.ok) return checked;
    const enforcementEligibility = decision.executionMode === "enforced";
    return {
      ok: true,
      value: {
        decision: checked.value,
        completeness,
        enforcementEligibility,
        reasons: [...reasons],
        explanation: renderReviewExplanation(
          completeness,
          decision.qualityOutcome,
          enforcementEligibility,
          context.locale ?? "zh-CN",
          [...reasons],
        ),
      },
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "schema",
          message: `review gate evaluation failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
      ],
    };
  }
}

/** Public one-shot API: validates all gate inputs once, then evaluates. */
export function evaluateReviewGate(
  input: EvaluateReviewGateInput,
): ValidationResult<ReviewGateResult> {
  const prepared = prepareReviewGateContext(input);
  if (!prepared.ok) return prepared;
  return evaluateReviewGateContext(prepared.value, input.execution);
}
