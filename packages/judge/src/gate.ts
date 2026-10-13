import type { Criterion, Verdict } from "@lorelum/judge-protocol";
import {
  type CalibrationObservation,
  definitionIdentity,
  type EvidenceBundle,
  type GateDecision,
  type GatePolicyV2,
  gatePolicyIdentityV2,
  identityOf,
  instrumentIdentity,
  type MeasurementRun,
  type ValidationIssue,
  type ValidationResult,
  validateDefinition,
  validateEvidenceBundle,
  validateGateDecision,
  validateGatePolicyForV2,
  validateInstrument,
  validateRun,
  validateVerdictEvidence,
} from "@lorelum/judge-protocol";
import { isVerifiedCalibration } from "./calibration.js";

export type GateLocale = "zh-CN" | "en-US";
type GateFailureCategory = Extract<
  CalibrationObservation,
  { readonly status: "failed" }
>["failureCategory"];

export type GateObservation =
  | {
      readonly status: "completed";
      readonly id: string;
      readonly run: unknown;
      readonly evidenceBundle: unknown;
    }
  | Extract<CalibrationObservation, { status: "failed" }>;

export interface EvaluateGateInput {
  readonly id: string;
  readonly definition: unknown;
  readonly instrument: unknown;
  readonly policy: unknown;
  readonly taskClass: string;
  readonly evidenceShape: string;
  readonly observations: readonly GateObservation[];
  readonly calibration?: unknown;
  readonly now: string;
  readonly locale?: GateLocale;
}

interface ParsedObservation {
  readonly run?: MeasurementRun;
  readonly evidenceBundle?: EvidenceBundle;
  readonly failure?: GateFailureCategory;
}

interface CriterionResult {
  readonly finding: GateDecision["findings"][number];
  readonly mandatory: boolean;
}

function summaryText(
  outcome: GateDecision["qualityOutcome"],
  mode: GateDecision["executionMode"],
  locale: GateLocale,
): string {
  if (locale === "zh-CN") {
    const result = outcome === "pass" ? "通过" : outcome === "fail" ? "未通过" : "暂时无法判断";
    const prefix =
      mode === "enforced"
        ? "自动把关"
        : mode === "diagnostic"
          ? "诊断评审（仅供参考，不会阻止流程）"
          : mode === "indeterminate"
            ? "暂时无法自动把关"
            : "参考评审（不会阻止流程）";
    return `${prefix}：${result}。`;
  }
  const result = outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "Unable to determine";
  const prefix =
    mode === "enforced"
      ? "Enforced review"
      : mode === "diagnostic"
        ? "Diagnostic review (non-blocking)"
        : mode === "indeterminate"
          ? "Automatic review unavailable"
          : "Advisory review (non-blocking)";
  return `${prefix}: ${result}.`;
}

function anchorDescription(criterion: Criterion, verdict: Verdict["verdict"]): string {
  return (
    criterion.anchors.find((anchor) => anchor.verdict === verdict)?.description ??
    criterion.description
  );
}

const failureLabels: Record<GateLocale, Record<GateFailureCategory, string>> = {
  "zh-CN": {
    rubric: "评审规则问题",
    fixture_label: "校准标签问题",
    evidence: "证据问题",
    prompt: "提示配置问题",
    provider: "评审服务问题",
    threshold: "决策门槛配置问题",
    measurement_noise: "重复评审波动",
    execution: "评审未完成",
    unattributed: "原因未确认",
  },
  "en-US": {
    rubric: "rubric issue",
    fixture_label: "calibration label issue",
    evidence: "evidence issue",
    prompt: "review prompt configuration issue",
    provider: "review service issue",
    threshold: "decision threshold configuration issue",
    measurement_noise: "repeated review variation",
    execution: "incomplete review",
    unattributed: "unattributed cause",
  },
};

function describeFailureCategories(
  categories: readonly GateFailureCategory[],
  locale: GateLocale,
): string[] {
  return [...new Set(categories)].sort().map((category) => failureLabels[locale][category]);
}

function nextStep(
  reason: GateDecision["findings"][number]["reason"],
  outcome: GateDecision["findings"][number]["outcome"],
  categories: readonly GateFailureCategory[],
  locale: GateLocale,
): string {
  const distinctCategories = new Set(categories);
  if (locale === "zh-CN") {
    if (reason === "unacceptable")
      return outcome === "advisory"
        ? "可按需要修复该项并重新评审；它不是必选阻塞项。"
        : "修复该项并重新运行评审。";
    if (reason === "disagreement") return "复核分歧结果，或增加独立评审次数。";
    if (reason === "execution_failure")
      return distinctCategories.has("provider")
        ? "确认评审服务恢复后，重新运行未完成的评审。"
        : "检查评审失败记录后，重新运行未完成的评审。";
    if (reason === "measurement_failure")
      return "根据列出的失败类别复核对应的结果或输入，再重新评审。";
    if (reason === "abstention")
      return "复核本次判断及其依据；必要时增加独立评审或补充针对性材料。这不表示质量不合格。";
    if (reason === "unsupported_evidence") return "补充可读取且能支持判断的证据后重新评审。";
    if (reason === "unavailable_evidence")
      return "检查证据来源、访问权限或采集过程，确认材料可读取后重新评审。";
    if (reason === "missing_evidence") return "补充或核实尚未提供的证据后重新评审。";
    if (reason === "unattributed_failure")
      return "检查评审记录和相关输入；原因未确认前，不要把它当作品质量失败。";
    return "无需处理。";
  }
  if (reason === "unacceptable")
    return outcome === "advisory"
      ? "You may address this item and rerun the review; it is not a mandatory blocker."
      : "Fix this requirement and rerun the review.";
  if (reason === "disagreement")
    return "Review the conflicting judgments or collect more independent reviews.";
  if (reason === "execution_failure")
    return distinctCategories.has("provider")
      ? "Restore the review service and rerun the incomplete evaluation."
      : "Review the recorded failure details and rerun the incomplete evaluation.";
  if (reason === "measurement_failure")
    return "Review the results or inputs indicated by the failure categories, then rerun.";
  if (reason === "abstention")
    return "Review the judgment and its basis; collect another independent review or targeted evidence if needed. This is not a quality failure.";
  if (reason === "unsupported_evidence")
    return "Provide readable evidence that supports the judgment, then rerun.";
  if (reason === "unavailable_evidence")
    return "Check access to the evidence source or its collection, restore availability, then rerun the review.";
  if (reason === "missing_evidence")
    return "Provide or verify the evidence that has not been collected, then rerun the review.";
  if (reason === "unattributed_failure")
    return "Check the review record and its inputs; do not treat an unattributed failure as a quality failure.";
  return "No action required.";
}

function findingMessage(
  criterion: Criterion,
  outcome: GateDecision["findings"][number]["outcome"],
  reason: GateDecision["findings"][number]["reason"],
  verdict: Verdict["verdict"] | undefined,
  failureCategories: readonly GateFailureCategory[],
  requiredEvidenceIds: readonly string[],
  locale: GateLocale,
): string {
  const failureDetails = describeFailureCategories(failureCategories, locale);
  const description =
    verdict === undefined ? criterion.description : anchorDescription(criterion, verdict);
  if (locale === "zh-CN") {
    if (outcome === "pass") return `${criterion.description}：符合要求。`;
    if (outcome === "fail") return `${criterion.description}：${description}`;
    if (outcome === "advisory") {
      if (reason === "acceptable")
        return `${criterion.description}：符合要求（可选项，不影响整体通过）。`;
      if (reason === "unacceptable")
        return `${criterion.description}：${description}。这是可选建议，不会阻止整体通过。`;
      const base = `${criterion.description}：有待关注，但不是必选阻塞项。`;
      if (reason === "disagreement")
        return `${base}${verdict === undefined ? "" : `当前多数判断：${description}。`}重复评审结论不一致。`;
      if (failureDetails.length > 0) return `${base}评审记录：${failureDetails.join("、")}。`;
      if (reason === "abstention") return `${base}Judge 未能作出明确判断；这不表示质量不合格。`;
      if (reason === "unavailable_evidence")
        return `${base}所需证据当前不可读取（${requiredEvidenceIds.join("、")}）。`;
      if (reason === "missing_evidence")
        return `${base}尚未提供或采集所需证据（${requiredEvidenceIds.join("、")}）。`;
      if (reason === "unsupported_evidence") return `${base}现有证据无法支持明确结论。`;
      return base;
    }
    if (reason === "disagreement")
      return `暂时无法判断“${criterion.description}”：重复评审结论不一致。${failureDetails.length > 0 ? ` 另有评审问题：${failureDetails.join("、")}。` : ""}`;
    if (reason === "execution_failure")
      return `暂时无法判断“${criterion.description}”：${failureDetails.length > 0 ? failureDetails.join("、") : "评审未能完整执行"}。`;
    if (reason === "unsupported_evidence")
      return `暂时无法判断“${criterion.description}”：现有证据无法支持该结论。`;
    if (reason === "unavailable_evidence")
      return `暂时无法判断“${criterion.description}”：所需证据当前不可读取（${requiredEvidenceIds.join("、")}）。`;
    if (reason === "missing_evidence")
      return `暂时无法判断“${criterion.description}”：尚未提供或采集所需证据（${requiredEvidenceIds.join("、")}）。`;
    if (reason === "measurement_failure")
      return `暂时无法判断“${criterion.description}”：评审发现${failureDetails.join("、")}。`;
    if (reason === "unattributed_failure")
      return `暂时无法判断“${criterion.description}”：评审过程中出现问题，原因未能确定。`;
    if (reason === "abstention")
      return `暂时无法判断“${criterion.description}”：Judge 返回了“未知 / 证据不足”，未能作出明确判断。请复核现有依据或重新评审；这不表示质量不合格。`;
    return `暂时无法判断“${criterion.description}”：现有信息不足以形成明确结论。`;
  }
  if (outcome === "pass") return `${criterion.description}: satisfied.`;
  if (outcome === "fail") return `${criterion.description}: ${description}`;
  if (outcome === "advisory") {
    if (reason === "acceptable")
      return `${criterion.description}: satisfied (optional; does not affect overall acceptance).`;
    if (reason === "unacceptable")
      return `${criterion.description}: ${description}. This is advisory and does not block overall acceptance.`;
    const base = `${criterion.description}: needs attention but is not a mandatory blocker.`;
    if (reason === "disagreement")
      return `${base}${verdict === undefined ? "" : ` Current majority judgment: ${description}.`} Repeated judgments disagree.`;
    if (failureDetails.length > 0) return `${base} Review record: ${failureDetails.join(", ")}.`;
    if (reason === "abstention")
      return `${base} The judge did not reach a clear conclusion; this is not a quality failure.`;
    if (reason === "unavailable_evidence")
      return `${base} Required evidence is currently unavailable (${requiredEvidenceIds.join(", ")}).`;
    if (reason === "missing_evidence")
      return `${base} Required evidence has not been provided or collected (${requiredEvidenceIds.join(", ")}).`;
    if (reason === "unsupported_evidence")
      return `${base} The available evidence does not support a clear conclusion.`;
    return base;
  }
  if (reason === "disagreement")
    return `Unable to determine ${criterion.description}: repeated judgments disagree.${failureDetails.length > 0 ? ` Other review issues: ${failureDetails.join(", ")}.` : ""}`;
  if (reason === "execution_failure")
    return `Unable to determine ${criterion.description}: ${failureDetails.length > 0 ? failureDetails.join(", ") : "the review did not complete"}.`;
  if (reason === "unsupported_evidence")
    return `Unable to determine ${criterion.description}: the available evidence does not support a conclusion.`;
  if (reason === "unavailable_evidence")
    return `Unable to determine ${criterion.description}: required evidence is currently unavailable (${requiredEvidenceIds.join(", ")}).`;
  if (reason === "missing_evidence")
    return `Unable to determine ${criterion.description}: required evidence has not been provided or collected (${requiredEvidenceIds.join(", ")}).`;
  if (reason === "measurement_failure")
    return `Unable to determine ${criterion.description}: review issues were reported (${failureDetails.join(", ")}).`;
  if (reason === "unattributed_failure")
    return `Unable to determine ${criterion.description}: a review problem occurred, but its cause is unknown.`;
  if (reason === "abstention")
    return `Unable to determine ${criterion.description}: the judge returned an unknown or insufficient verdict and did not reach a clear conclusion. Review the current basis or rerun the review; this is not a quality failure.`;
  return `Unable to determine ${criterion.description}: the available information is not sufficient to reach a clear conclusion.`;
}

function requiredEvidenceState(
  criterion: Criterion,
  bundle: EvidenceBundle,
): "available" | "missing" | "unavailable" | "unsupported" {
  let missing = false;
  let unavailable = false;
  let unsupported = false;
  for (const selector of criterion.evidence) {
    const item = bundle.items.find((entry) => entry.id === selector.evidenceId);
    if (item === undefined || item.status === "no_evidence") {
      missing = true;
    } else if (item.status === "unavailable") {
      unavailable = true;
    } else if (
      item.status === "contradiction" ||
      item.render?.state === "withheld" ||
      item.render?.renderedLength === 0
    ) {
      unsupported = true;
    }
  }
  if (unsupported) return "unsupported";
  if (unavailable) return "unavailable";
  return missing ? "missing" : "available";
}

function evaluateCriterion(
  criterion: Criterion,
  policy: GatePolicyV2["criteria"][number],
  observations: readonly ParsedObservation[],
  minimumAgreement: number,
  locale: GateLocale,
): CriterionResult {
  const votes: Verdict["verdict"][] = [];
  const evidenceIds = new Set<string>();
  const failureCategories = new Set<GateFailureCategory>();
  let evidenceFailure = false;
  let executionFailure = false;
  let measurementFailure = false;
  let unattributedFailure = false;
  let missingRequiredEvidence = false;
  let unavailableRequiredEvidence = false;
  for (const observation of observations) {
    if (observation.failure !== undefined) {
      failureCategories.add(observation.failure);
      if (observation.failure === "evidence") evidenceFailure = true;
      else if (observation.failure === "provider" || observation.failure === "execution")
        executionFailure = true;
      else if (observation.failure === "unattributed") unattributedFailure = true;
      else measurementFailure = true;
      continue;
    }
    if (observation.run === undefined || observation.evidenceBundle === undefined) {
      executionFailure = true;
      continue;
    }
    const verdict = observation.run.verdicts.find((entry) => entry.criterionId === criterion.id);
    if (verdict === undefined) {
      executionFailure = true;
      continue;
    }
    const checked = validateVerdictEvidence(criterion, verdict, observation.evidenceBundle);
    if (!checked.ok) {
      evidenceFailure = true;
      failureCategories.add("evidence");
      continue;
    }
    if (verdict.verdict === "unknown" || verdict.verdict === "insufficient") {
      const evidenceState = requiredEvidenceState(criterion, observation.evidenceBundle);
      if (evidenceState === "unsupported") evidenceFailure = true;
      if (evidenceState === "missing") missingRequiredEvidence = true;
      if (evidenceState === "unavailable") unavailableRequiredEvidence = true;
    }
    for (const evidenceId of verdict.evidenceIds) evidenceIds.add(evidenceId);
    votes.push(verdict.verdict);
  }
  const counts = new Map<Verdict["verdict"], number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  const largest = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()].filter(([, count]) => count === largest);
  const leader = leaders.length === 1 ? leaders[0]?.[0] : undefined;
  const decisive = leader !== undefined && leader !== "unknown" && leader !== "insufficient";
  const prediction =
    decisive && largest / observations.length >= minimumAgreement ? leader : undefined;
  const disagrees = new Set(votes).size > 1;
  const abstained =
    votes.length > 0 && votes.every((vote) => vote === "unknown" || vote === "insufficient");

  let outcome: GateDecision["findings"][number]["outcome"];
  let reason: GateDecision["findings"][number]["reason"];
  if (prediction === undefined) {
    outcome = criterion.mandatory ? "indeterminate" : "advisory";
    reason = disagrees
      ? "disagreement"
      : evidenceFailure
        ? "unsupported_evidence"
        : executionFailure
          ? "execution_failure"
          : measurementFailure
            ? "measurement_failure"
            : unattributedFailure
              ? "unattributed_failure"
              : unavailableRequiredEvidence
                ? "unavailable_evidence"
                : missingRequiredEvidence
                  ? "missing_evidence"
                  : abstained
                    ? "abstention"
                    : "missing_evidence";
  } else if (!policy.acceptedVerdicts.some((verdict) => verdict === prediction)) {
    outcome = criterion.mandatory ? "fail" : "advisory";
    reason = disagrees ? "disagreement" : "unacceptable";
  } else {
    outcome = criterion.mandatory ? "pass" : "advisory";
    reason = disagrees ? "disagreement" : "acceptable";
  }
  const requiredEvidenceIds =
    prediction === undefined &&
    (reason === "missing_evidence" ||
      reason === "unavailable_evidence" ||
      reason === "unsupported_evidence")
      ? criterion.evidence.map((selector) => selector.evidenceId)
      : [];
  const normalizedFailureCategories = [...failureCategories].sort();
  let message = findingMessage(
    criterion,
    outcome,
    reason,
    prediction,
    normalizedFailureCategories,
    requiredEvidenceIds,
    locale,
  );
  if (prediction !== undefined && disagrees) {
    const note =
      locale === "zh-CN"
        ? "重复评审存在分歧，当前结论达到预设一致比例。"
        : "Repeated reviews disagree, but the result meets the configured agreement threshold.";
    message = `${message} ${note}`;
  }
  if (prediction !== undefined && normalizedFailureCategories.length > 0) {
    const note =
      locale === "zh-CN"
        ? `部分重复评审未能使用：${describeFailureCategories(normalizedFailureCategories, locale).join("、")}。`
        : `Some repeated reviews could not be used: ${describeFailureCategories(normalizedFailureCategories, locale).join(", ")}.`;
    message = `${message} ${note}`;
  }
  return {
    mandatory: criterion.mandatory,
    finding: {
      criterionId: criterion.id,
      criterionDescription: criterion.description,
      outcome,
      reason,
      message,
      ...(normalizedFailureCategories.length > 0
        ? { failureCategories: normalizedFailureCategories }
        : {}),
      evidenceIds: [...evidenceIds],
      requiredEvidenceIds,
      nextStep: nextStep(reason, outcome, normalizedFailureCategories, locale),
    },
  };
}

export function evaluateGate(input: EvaluateGateInput): ValidationResult<GateDecision> {
  try {
    const locale = input.locale ?? "zh-CN";
    const definitionResult = validateDefinition(input.definition);
    const instrumentResult = validateInstrument(input.instrument);
    const policyResult = validateGatePolicyForV2(input.policy, input.definition, input.instrument);
    const issues: ValidationIssue[] = [
      ...(!definitionResult.ok ? definitionResult.issues : []),
      ...(!instrumentResult.ok ? instrumentResult.issues : []),
      ...(!policyResult.ok ? policyResult.issues : []),
    ];
    if (!definitionResult.ok || !instrumentResult.ok || !policyResult.ok)
      return { ok: false, issues };
    if (input.observations.length > instrumentResult.value.repetitions) {
      return {
        ok: false,
        issues: [
          {
            path: "$.observations",
            code: "report_mismatch",
            message: `expected at most ${instrumentResult.value.repetitions} observations`,
          },
        ],
      };
    }
    const definitionId = definitionIdentity(definitionResult.value);
    const instrumentId = instrumentIdentity(instrumentResult.value);
    const policyId = gatePolicyIdentityV2(policyResult.value);
    if (!definitionId.ok || !instrumentId.ok || !policyId.ok) {
      return {
        ok: false,
        issues: [
          ...(!definitionId.ok ? definitionId.issues : []),
          ...(!instrumentId.ok ? instrumentId.issues : []),
          ...(!policyId.ok ? policyId.issues : []),
        ],
      };
    }

    const selectedScope = policyResult.value.scopes.find(
      (scope) => scope.taskClass === input.taskClass && scope.evidenceShape === input.evidenceShape,
    );
    const verified = isVerifiedCalibration(input.calibration) ? input.calibration : undefined;
    const artifact = verified?.artifact;
    const now = Date.parse(input.now);
    const selectedScopeIdentity =
      selectedScope === undefined
        ? undefined
        : identityOf("lorelum.judge.calibration-scope/v1", selectedScope);
    const calibrationMatches =
      verified !== undefined &&
      artifact !== undefined &&
      (artifact.status === "enforced" ||
        artifact.status === "shadow" ||
        artifact.status === "diagnostic") &&
      Number.isFinite(now) &&
      Date.parse(artifact.validFrom) <= now &&
      now < Date.parse(artifact.validUntil) &&
      verified.definitionIdentity === definitionId.identity &&
      verified.instrumentIdentity === instrumentId.identity &&
      artifact.policyIdentity === policyId.identity &&
      selectedScope !== undefined &&
      selectedScopeIdentity?.ok === true &&
      artifact.scopeIdentity === selectedScopeIdentity.identity &&
      selectedScope.criterionIds.every((criterionId) =>
        artifact.scope.criterionIds.includes(criterionId),
      );
    const executionMode: GateDecision["executionMode"] =
      artifact?.status === "enforced" && calibrationMatches
        ? "enforced"
        : artifact?.status === "shadow" && calibrationMatches
          ? "shadow"
          : artifact?.status === "diagnostic" && calibrationMatches
            ? "diagnostic"
            : selectedScope === undefined
              ? "indeterminate"
              : policyResult.value.onUncalibrated;

    const observationIds = new Set<string>();
    const runIds = new Set<string>();
    const observationIssues: ValidationIssue[] = [];
    const parsed: ParsedObservation[] = input.observations.map((observation, index) => {
      if (observationIds.has(observation.id)) {
        observationIssues.push({
          path: `$.observations[${index}].id`,
          code: "duplicate_verdict",
          message: `duplicate observation "${observation.id}"`,
        });
      }
      observationIds.add(observation.id);
      if (observation.status === "failed") return { failure: observation.failureCategory };
      const run = validateRun(definitionResult.value, instrumentResult.value, observation.run);
      const bundle = validateEvidenceBundle(observation.evidenceBundle);
      if (run.ok) {
        if (runIds.has(run.value.id)) {
          observationIssues.push({
            path: `$.observations[${index}].run.id`,
            code: "duplicate_verdict",
            message: `measurement run "${run.value.id}" cannot count as multiple repetitions`,
          });
        }
        runIds.add(run.value.id);
      }
      if (!run.ok || !bundle.ok) {
        const evidenceFailure =
          !bundle.ok ||
          (!run.ok && run.issues.some((issue) => issue.code === "verdict_without_evidence"));
        return { failure: evidenceFailure ? "evidence" : "unattributed" };
      }
      return { run: run.value, evidenceBundle: bundle.value };
    });
    if (observationIssues.length > 0) return { ok: false, issues: observationIssues };
    if (input.observations.length < instrumentResult.value.repetitions) {
      for (
        let index = input.observations.length;
        index < instrumentResult.value.repetitions;
        index += 1
      ) {
        parsed.push({ failure: "execution" });
      }
    }
    const criteria = new Map(
      definitionResult.value.criteria.map((criterion) => [criterion.id, criterion]),
    );
    const rules = new Map(policyResult.value.criteria.map((rule) => [rule.criterionId, rule]));
    const applicableIds = selectedScope?.criterionIds ?? [];
    const results: CriterionResult[] = applicableIds.flatMap((criterionId) => {
      const criterion = criteria.get(criterionId);
      const rule = rules.get(criterionId);
      return criterion === undefined || rule === undefined
        ? []
        : [evaluateCriterion(criterion, rule, parsed, policyResult.value.minimumAgreement, locale)];
    });
    const findings: GateDecision["findings"][number][] = results.map((result) => result.finding);
    if (selectedScope === undefined) {
      for (const criterion of definitionResult.value.criteria) {
        findings.push({
          criterionId: criterion.id,
          criterionDescription: criterion.description,
          outcome: criterion.mandatory ? "indeterminate" : "advisory",
          reason: "not_applicable",
          message:
            locale === "zh-CN"
              ? `“${criterion.description}”尚未配置适用于当前任务类型和证据形态的评审范围。`
              : `No review scope is configured for ${criterion.description} with this task class and evidence shape.`,
          evidenceIds: [],
          requiredEvidenceIds: [],
          nextStep:
            locale === "zh-CN"
              ? "为该任务范围配置评审策略并完成校准。"
              : "Configure and calibrate a policy for this task scope.",
        });
      }
    }
    const failed = results.some((result) => result.mandatory && result.finding.outcome === "fail");
    const indeterminate = results.some(
      (result) => result.mandatory && result.finding.outcome === "indeterminate",
    );
    const qualityOutcome: GateDecision["qualityOutcome"] = failed
      ? "fail"
      : indeterminate || results.length === 0
        ? "indeterminate"
        : "pass";
    const decision: GateDecision = {
      schema: "lorelum.judge.gate-decision/v1",
      id: input.id,
      definitionIdentity: definitionId.identity,
      instrumentIdentity: instrumentId.identity,
      qualityOutcome,
      executionMode,
      summary: summaryText(qualityOutcome, executionMode, locale),
      findings,
    };
    return validateGateDecision(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      issues: [{ path: "$", code: "schema", message: `gate evaluation failed: ${message}` }],
    };
  }
}
