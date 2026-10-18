import {
  type GateDecision,
  type InstrumentProfileV2,
  instrumentRepetitions,
  type ReviewExecution,
  type ValidationIssue,
  type ValidationResult,
  validateGateDecision,
  validateGatePolicyForV2,
  validateInstrumentV2,
  validateMeasurementDefinitionV2,
  validateReviewExecution,
} from "@lorelum/judge-protocol";

import { isVerifiedCalibration } from "./calibration.js";
import { evaluateGate, type GateLocale, type GateObservation } from "./gate.js";
import { renderSummary } from "./gate-presentation.js";
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

export interface ReviewGateResult {
  readonly decision: GateDecision;
  readonly completeness: ReviewCompleteness;
  readonly enforcementEligibility: boolean;
  readonly reasons: readonly string[];
  readonly explanation: string;
}

const PARAMETER_KEYS = ["temperature", "topP", "maxTokens", "seed"] as const;

const REASON_LABELS: Readonly<Record<string, { readonly zh: string; readonly en: string }>> = {
  calibration_unavailable: { zh: "没有适用的校准", en: "no applicable calibration" },
  calibration_unverified: { zh: "校准未经可信加载器验证", en: "calibration was not verified" },
  request_mismatch: {
    zh: "实际请求与声明的方法不一致",
    en: "the actual request differs from the declared method",
  },
  response_metadata_missing: {
    zh: "服务端响应信息缺失",
    en: "response metadata is missing",
  },
  response_model_unknown: {
    zh: "服务端返回模型无法确认",
    en: "the response model is unknown",
  },
  response_model_conflict: {
    zh: "服务端返回模型与请求模型冲突",
    en: "the response model conflicts with the request",
  },
  finish_reason_unknown: {
    zh: "服务端完成原因未知",
    en: "the finish reason is unknown",
  },
  prompt_identity_unknown: {
    zh: "实际规则提示身份未知",
    en: "the actual rule prompt identity is unknown",
  },
  prompt_identity_conflict: {
    zh: "实际规则提示与方法身份冲突",
    en: "the actual rule prompt conflicts with the method",
  },
  render_identity_conflict: {
    zh: "实际消息渲染与执行记录冲突",
    en: "the rendered messages conflict with the execution record",
  },
  execution_complete: { zh: "评审按计划完成", en: "the review completed" },
  execution_partial: { zh: "评审只得到部分结论", en: "the review is partial" },
  execution_failed: { zh: "评审没有产生可用结论", en: "the review failed" },
  execution_cancelled: { zh: "评审被取消", en: "the review was cancelled" },
  execution_not_started: { zh: "评审没有开始", en: "the review did not start" },
};

function reasonLabel(reason: string, locale: GateLocale): string {
  const labels = REASON_LABELS[reason];
  if (labels === undefined) return reason;
  return locale === "en-US" ? labels.en : labels.zh;
}

function parameterValue(value: unknown, key: string): number | undefined {
  if (!isRecord(value) || !(key in value)) return undefined;
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

function sameParameters(left: unknown, right: unknown): boolean {
  return PARAMETER_KEYS.every((key) => parameterValue(left, key) === parameterValue(right, key));
}

interface Observations {
  readonly observations: readonly GateObservation[];
  readonly reasons: readonly string[];
}

function observationsFor(
  execution: ReviewExecution,
):
  | { readonly ok: true; readonly value: Observations }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] } {
  const observations: GateObservation[] = [];
  const issues: ValidationIssue[] = [];
  for (const [index, attempt] of execution.attempts.entries()) {
    const path = `$.execution.attempts[${index}]`;
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
      if (attempt.failure === undefined) {
        issues.push({
          path: `${path}.failure`,
          code: "report_mismatch",
          message: "a failed attempt needs a structured failure",
        });
        continue;
      }
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
      issues.push({
        path: `${path}.evidenceBundle`,
        code: "report_mismatch",
        message: "an assessed attempt needs its evidence bundle",
      });
      continue;
    }
    if (attempt.status === "completed") {
      if (attempt.run === undefined) {
        issues.push({
          path: `${path}.run`,
          code: "report_mismatch",
          message: "a completed attempt needs its measurement run",
        });
        continue;
      }
      observations.push({
        id: attempt.id,
        status: "completed",
        run: attempt.run,
        evidenceBundle: attempt.evidenceBundle,
      });
      continue;
    }
    observations.push({
      id: attempt.id,
      status: "partial",
      verdicts: attempt.verdicts ?? [],
      evidenceBundle: attempt.evidenceBundle,
    });
  }
  return issues.length === 0
    ? { ok: true, value: { observations, reasons: [] } }
    : { ok: false, issues };
}

function requestIssues(
  execution: ReviewExecution,
  instrument: InstrumentProfileV2,
): { readonly reasons: readonly string[]; readonly blocking: boolean } {
  if (instrument.method.kind !== "llm") {
    return { reasons: [], blocking: false };
  }
  const method = instrument.method;
  const reasons = new Set<string>();
  let blocking = false;
  let anyResponse = false;
  for (const attempt of execution.attempts) {
    if (attempt.llm === undefined) continue;
    const request = attempt.llm.request;
    if (
      request.model !== method.model.name ||
      request.modelProvider !== method.model.provider ||
      request.endpointIdentity !== method.endpointIdentity ||
      !sameParameters(request.parameters, method.decoding)
    ) {
      reasons.add("request_mismatch");
      blocking = true;
    }
    if (request.promptIdentity === undefined) {
      reasons.add("prompt_identity_unknown");
      blocking = true;
    } else if (request.promptIdentity !== method.promptIdentity) {
      reasons.add("prompt_identity_conflict");
      blocking = true;
    }
    if (attempt.status === "completed") {
      if (request.renderIdentity === undefined || attempt.run?.renderIdentity === undefined) {
        reasons.add("render_identity_conflict");
        blocking = true;
      } else if (attempt.run.renderIdentity !== request.renderIdentity) {
        reasons.add("render_identity_conflict");
        blocking = true;
      }
    }
    const response = attempt.llm.response;
    if (response === undefined) {
      reasons.add("response_metadata_missing");
      blocking = true;
      continue;
    }
    anyResponse = true;
    if (response.model === undefined) {
      reasons.add("response_model_unknown");
      blocking = true;
    } else if (response.model !== request.model) {
      reasons.add("response_model_conflict");
      blocking = true;
    }
    if (response.finishReason === undefined) {
      reasons.add("finish_reason_unknown");
      blocking = true;
    }
  }
  if (!anyResponse && execution.attempts.some((attempt) => attempt.status !== "not_started")) {
    reasons.add("response_metadata_missing");
    blocking = true;
  }
  return { reasons: [...reasons], blocking };
}

function explanationFor(
  completeness: ReviewCompleteness,
  quality: GateDecision["qualityOutcome"],
  eligibility: boolean,
  locale: GateLocale,
  reasons: readonly string[],
): string {
  if (locale === "en-US") {
    const state =
      completeness === "complete"
        ? "The review completed its planned attempts."
        : completeness === "cancelled"
          ? "The review was cancelled; later attempts did not start."
          : completeness === "partial"
            ? "Only some criteria produced a legal finding; unfinished items are not filled in."
            : completeness === "failed"
              ? "The review attempts did not produce a usable finding."
              : "No review attempt started.";
    const gate =
      quality === "fail"
        ? "A supported required finding failed."
        : quality === "pass"
          ? "All required findings are acceptable."
          : "The quality result cannot be determined.";
    const enforcement = eligibility
      ? "Automatic enforcement is available."
      : "This result is advisory and cannot automatically block delivery.";
    return [
      state,
      gate,
      enforcement,
      reasons.length === 0
        ? ""
        : `Notes: ${reasons.map((reason) => reasonLabel(reason, locale)).join(", ")}.`,
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }
  const state =
    completeness === "complete"
      ? "本次评审按计划完成。"
      : completeness === "cancelled"
        ? "本次评审被取消，后续执行没有开始。"
        : completeness === "partial"
          ? "本次评审只有部分条目得到合法结论，未完成项没有被补写。"
          : completeness === "failed"
            ? "本次评审没有得到可用的结论。"
            : "本次评审没有开始执行。";
  const gate =
    quality === "fail"
      ? "已确认的必选项不满足。"
      : quality === "pass"
        ? "必选项均获得可接受结论。"
        : "当前无法判断整体质量。";
  const enforcement = eligibility ? "结果符合自动把关资格。" : "该结果仅供参考，不能自动阻止交付。";
  return [
    state,
    gate,
    enforcement,
    reasons.length === 0
      ? ""
      : `说明：${reasons.map((reason) => reasonLabel(reason, locale)).join("、")}。`,
  ]
    .filter((part) => part.length > 0)
    .join("");
}

/**
 * Projects a ReviewExecution onto #9 gate semantics. Legal partial findings stay
 * visible; no verdict is invented for a missing item. Incomplete executions can
 * fail (a supported required failure is kept) but never pass or gain enforcement.
 */
export function evaluateReviewGate(
  input: EvaluateReviewGateInput,
): ValidationResult<ReviewGateResult> {
  try {
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
    const execution = validateReviewExecution(input.execution, definition.value, instrument.value);
    if (!execution.ok) return execution;
    if (execution.value.plannedCount !== instrumentRepetitions(instrument.value)) {
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
    const projected = observationsFor(execution.value);
    if (!projected.ok) return projected;
    const requests = requestIssues(execution.value, instrument.value);
    const reasons = new Set<string>([...projected.value.reasons, ...requests.reasons]);
    if (input.calibration === undefined) {
      reasons.add("calibration_unavailable");
    } else if (!isVerifiedCalibration(input.calibration)) {
      reasons.add("calibration_unverified");
    }
    const completeness = reviewCompleteness(execution.value);
    reasons.add(`execution_${completeness}`);
    const gate = evaluateGate({
      id: input.id,
      definition: definition.value,
      instrument: instrument.value,
      policy: policy.value,
      taskClass: input.taskClass,
      evidenceShape: input.evidenceShape,
      observations: projected.value.observations,
      ...(input.calibration === undefined ? {} : { calibration: input.calibration }),
      now: input.now,
      ...(input.locale === undefined ? {} : { locale: input.locale }),
    });
    if (!gate.ok) return gate;
    const resolved = gate.value;
    const downgrade =
      (completeness !== "complete" || requests.blocking) && resolved.executionMode === "enforced";
    const executionMode: GateDecision["executionMode"] = downgrade
      ? policy.value.onUncalibrated
      : resolved.executionMode;
    const findings =
      completeness === "complete"
        ? resolved.findings
        : resolved.findings.map((finding) =>
            finding.outcome === "advisory" &&
            (finding.reason === "missing_evidence" ||
              finding.reason === "unavailable_evidence" ||
              finding.reason === "unsupported_evidence" ||
              finding.reason === "execution_failure" ||
              finding.reason === "measurement_failure" ||
              finding.reason === "unattributed_failure" ||
              finding.reason === "abstention" ||
              finding.reason === "disagreement")
              ? { ...finding, outcome: "indeterminate" as const }
              : finding,
          );
    const finalQuality: GateDecision["qualityOutcome"] = findings.some(
      (finding) => finding.outcome === "fail",
    )
      ? "fail"
      : findings.length === 0 ||
          findings.every((finding) => finding.reason === "not_applicable") ||
          findings.some((finding) => finding.outcome === "indeterminate")
        ? "indeterminate"
        : "pass";
    const decision: GateDecision = {
      ...resolved,
      qualityOutcome: finalQuality,
      executionMode,
      findings,
      summary: renderSummary(finalQuality, executionMode, input.locale ?? "zh-CN"),
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
        explanation: explanationFor(
          completeness,
          decision.qualityOutcome,
          enforcementEligibility,
          input.locale ?? "zh-CN",
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
