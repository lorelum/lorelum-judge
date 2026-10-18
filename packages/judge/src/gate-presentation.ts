/**
 * Internal presentation layer for gate findings: the decision in `gate.ts`
 * owns the outcome/reason semantics, this module only renders deterministic
 * bilingual messages from the presentation model. Not exported from the
 * package entrypoint; external consumers use `evaluateGate` results.
 */
import type { Criterion, GateDecision, Verdict } from "@lorelum/judge-protocol";

type Finding = GateDecision["findings"][number];
type FailureCategory = NonNullable<Finding["failureCategories"]>[number];
type EvidenceStatus = NonNullable<Finding["evidenceStatuses"]>[number];
export type GateLocale = "zh-CN" | "en-US";
type MessageKey =
  | "pass"
  | "fail"
  | "optional_pass"
  | "optional_fail"
  | "optional_disagreement"
  | "optional_failure"
  | "optional_evidence"
  | "optional_abstention"
  | "optional_other"
  | "disagreement"
  | "execution_failure"
  | "evidence_failure"
  | "measurement_failure"
  | "unattributed_failure"
  | "abstention"
  | "indeterminate";
type ActionKey =
  | "evidence_remediation"
  | "fix_optional"
  | "fix_required"
  | "disagreement"
  | "provider_failure"
  | "execution_failure"
  | "measurement_failure"
  | "abstention"
  | "unsupported_citation"
  | "unsupported_evidence"
  | "unavailable_evidence"
  | "missing_evidence"
  | "unattributed_failure"
  | "none";

export interface FindingPresentationModel {
  readonly messageKey: MessageKey;
  readonly actionKey: ActionKey;
  readonly criterion: string;
  readonly detail: string;
  readonly hasVerdict: boolean;
  readonly failureCategories: readonly FailureCategory[];
  readonly evidenceStatuses: readonly EvidenceStatus[];
  readonly requiredEvidenceIds: readonly string[];
  readonly qualifiedDisagreement: boolean;
  readonly ignoredFailureCategories: readonly FailureCategory[];
  readonly partialEvidenceStatuses: readonly EvidenceStatus[];
}

interface FindingModelInput {
  readonly criterion: Criterion;
  readonly outcome: Finding["outcome"];
  readonly reason: Finding["reason"];
  readonly verdict?: Verdict["verdict"];
  readonly failureCategories: readonly FailureCategory[];
  readonly evidenceStatuses: readonly EvidenceStatus[];
  readonly requiredEvidenceIds: readonly string[];
  readonly qualifiedDisagreement?: boolean;
  readonly partialEvidenceStatuses?: readonly EvidenceStatus[];
}

export function createFindingPresentationModel(input: FindingModelInput): FindingPresentationModel {
  const {
    criterion,
    outcome,
    reason,
    verdict,
    failureCategories,
    evidenceStatuses,
    requiredEvidenceIds,
  } = input;
  const detail =
    verdict === undefined
      ? criterion.description
      : (criterion.anchors.find((anchor) => anchor.verdict === verdict)?.description ??
        criterion.description);
  const messageKey: MessageKey =
    outcome === "pass"
      ? "pass"
      : outcome === "fail"
        ? "fail"
        : outcome === "advisory"
          ? reason === "acceptable"
            ? "optional_pass"
            : reason === "unacceptable"
              ? "optional_fail"
              : reason === "disagreement"
                ? "optional_disagreement"
                : failureCategories.length > 0
                  ? "optional_failure"
                  : reason === "missing_evidence" ||
                      reason === "unavailable_evidence" ||
                      reason === "unsupported_evidence"
                    ? "optional_evidence"
                    : reason === "abstention"
                      ? "optional_abstention"
                      : "optional_other"
          : reason === "disagreement"
            ? "disagreement"
            : reason === "execution_failure"
              ? "execution_failure"
              : reason === "missing_evidence" ||
                  reason === "unavailable_evidence" ||
                  reason === "unsupported_evidence"
                ? "evidence_failure"
                : reason === "measurement_failure"
                  ? "measurement_failure"
                  : reason === "unattributed_failure"
                    ? "unattributed_failure"
                    : reason === "abstention"
                      ? "abstention"
                      : "indeterminate";

  const nonAvailableEvidence = evidenceStatuses.some((entry) => entry.status !== "available");
  const allEvidenceAvailable =
    evidenceStatuses.length > 0 && evidenceStatuses.every((entry) => entry.status === "available");
  const actionKey: ActionKey = nonAvailableEvidence
    ? "evidence_remediation"
    : reason === "unacceptable"
      ? outcome === "advisory"
        ? "fix_optional"
        : "fix_required"
      : reason === "disagreement"
        ? "disagreement"
        : reason === "execution_failure"
          ? failureCategories.includes("provider")
            ? "provider_failure"
            : "execution_failure"
          : reason === "measurement_failure"
            ? "measurement_failure"
            : reason === "abstention"
              ? "abstention"
              : reason === "unsupported_evidence"
                ? allEvidenceAvailable
                  ? "unsupported_citation"
                  : "unsupported_evidence"
                : reason === "unavailable_evidence"
                  ? "unavailable_evidence"
                  : reason === "missing_evidence"
                    ? "missing_evidence"
                    : reason === "unattributed_failure"
                      ? "unattributed_failure"
                      : "none";

  return {
    messageKey,
    actionKey,
    criterion: criterion.description,
    detail,
    hasVerdict: verdict !== undefined,
    failureCategories,
    evidenceStatuses,
    requiredEvidenceIds,
    qualifiedDisagreement: input.qualifiedDisagreement ?? false,
    ignoredFailureCategories: verdict === undefined ? [] : failureCategories,
    partialEvidenceStatuses: input.partialEvidenceStatuses ?? [],
  };
}

const failureLabels: Record<GateLocale, Record<FailureCategory, string>> = {
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
const evidenceLabels: Record<GateLocale, Record<EvidenceStatus["status"], string>> = {
  "zh-CN": {
    missing: "未采集",
    unavailable: "当前不可读取",
    truncated: "内容已截断",
    contradiction: "与其他证据矛盾",
    unsupported: "内容无法支持判断",
    available: "可读取",
  },
  "en-US": {
    missing: "not collected",
    unavailable: "currently unavailable",
    truncated: "truncated",
    contradiction: "contradicts other evidence",
    unsupported: "does not support the judgment",
    available: "available",
  },
};

function localized(locale: GateLocale, chinese: string, english: string): string {
  return locale === "zh-CN" ? chinese : english;
}
function formatFailureCategories(
  categories: readonly FailureCategory[],
  locale: GateLocale,
): string {
  return [...new Set(categories)]
    .sort()
    .map((category) => failureLabels[locale][category])
    .join(localized(locale, "、", ", "));
}
function formatEvidenceStatuses(statuses: readonly EvidenceStatus[], locale: GateLocale): string {
  return statuses
    .map(
      (entry) =>
        entry.evidenceId +
        (locale === "zh-CN" ? "：" : ": ") +
        evidenceLabels[locale][entry.status],
    )
    .join(localized(locale, "；", "; "));
}
function evidenceFinding(model: FindingPresentationModel, locale: GateLocale): string {
  const details = formatEvidenceStatuses(model.evidenceStatuses, locale);
  if (details.length > 0) {
    const summary = localized(
      locale,
      `所需证据状态：${details}。`,
      `Required evidence status: ${details}.`,
    );
    if (model.actionKey === "unsupported_citation")
      return localized(
        locale,
        `${summary}但当前评审引用无法支持结论。`,
        `${summary} The current review citations still do not support a conclusion.`,
      );
    return summary;
  }
  const ids = model.requiredEvidenceIds.join(localized(locale, "、", ", "));
  if (model.actionKey === "unavailable_evidence")
    return localized(
      locale,
      `所需证据当前不可读取（${ids}）。`,
      `Required evidence is currently unavailable (${ids}).`,
    );
  if (model.actionKey === "missing_evidence")
    return localized(
      locale,
      `尚未提供或采集所需证据（${ids}）。`,
      `Required evidence has not been provided or collected (${ids}).`,
    );
  return localized(
    locale,
    "现有证据无法支持该结论。",
    "The available evidence does not support a conclusion.",
  );
}

const messageTemplates: Record<
  MessageKey,
  (model: FindingPresentationModel, locale: GateLocale) => string
> = {
  pass: (m, l) => localized(l, `${m.criterion}：符合要求。`, `${m.criterion}: satisfied.`),
  fail: (m, l) => m.criterion + (l === "zh-CN" ? "：" : ": ") + m.detail,
  optional_pass: (m, l) =>
    localized(
      l,
      `${m.criterion}：符合要求（可选项，不影响整体通过）。`,
      `${m.criterion}: satisfied (optional; does not affect overall acceptance).`,
    ),
  optional_fail: (m, l) =>
    localized(
      l,
      `${m.criterion}：${m.detail}。这是可选建议，不会阻止整体通过。`,
      `${m.criterion}: ${m.detail}. This is advisory and does not block overall acceptance.`,
    ),
  optional_disagreement: (m, l) =>
    localized(
      l,
      m.criterion +
        "：有待关注，但不是必选阻塞项。" +
        (m.hasVerdict ? `当前多数判断：${m.detail}。` : "") +
        "重复评审结论不一致。" +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? `证据状态：${formatEvidenceStatuses(m.evidenceStatuses, l)}。`
          : ""),
      m.criterion +
        ": needs attention but is not a mandatory blocker." +
        (m.hasVerdict ? ` Current majority judgment: ${m.detail}.` : "") +
        " Repeated judgments disagree." +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? ` Evidence status: ${formatEvidenceStatuses(m.evidenceStatuses, l)}.`
          : ""),
    ),
  optional_failure: (m, l) =>
    localized(
      l,
      `${m.criterion}：有待关注，但不是必选阻塞项。评审记录：${formatFailureCategories(m.failureCategories, l)}。`,
      m.criterion +
        ": needs attention but is not a mandatory blocker. Review record: " +
        formatFailureCategories(m.failureCategories, l) +
        ".",
    ),
  optional_evidence: (m, l) =>
    localized(
      l,
      `${m.criterion}：有待关注，但不是必选阻塞项。${evidenceFinding(m, l)}`,
      `${m.criterion}: needs attention but is not a mandatory blocker. ${evidenceFinding(m, l)}`,
    ),
  optional_abstention: (m, l) =>
    localized(
      l,
      m.criterion +
        "：有待关注，但不是必选阻塞项。Judge 未能作出明确判断；" +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? `证据状态：${formatEvidenceStatuses(m.evidenceStatuses, l)}。`
          : "") +
        "这不表示质量不合格。",
      m.criterion +
        ": needs attention but is not a mandatory blocker. The judge did not reach a clear conclusion." +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? ` Evidence status: ${formatEvidenceStatuses(m.evidenceStatuses, l)}.`
          : "") +
        " This is not a quality failure.",
    ),
  optional_other: (m, l) =>
    localized(
      l,
      `${m.criterion}：有待关注，但不是必选阻塞项。`,
      `${m.criterion}: needs attention but is not a mandatory blocker.`,
    ),
  disagreement: (m, l) =>
    localized(
      l,
      "暂时无法判断“" +
        m.criterion +
        "”：重复评审结论不一致。" +
        (formatFailureCategories(m.failureCategories, l)
          ? ` 另有评审问题：${formatFailureCategories(m.failureCategories, l)}。`
          : "") +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? ` 所需证据状态：${formatEvidenceStatuses(m.evidenceStatuses, l)}。`
          : ""),
      "Unable to determine " +
        m.criterion +
        ": repeated judgments disagree." +
        (formatFailureCategories(m.failureCategories, l)
          ? ` Other review issues: ${formatFailureCategories(m.failureCategories, l)}.`
          : "") +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? ` Required evidence status: ${formatEvidenceStatuses(m.evidenceStatuses, l)}.`
          : ""),
    ),
  execution_failure: (m, l) =>
    localized(
      l,
      `暂时无法判断“${m.criterion}”：${formatFailureCategories(m.failureCategories, l) || "评审未能完整执行"}。`,
      "Unable to determine " +
        m.criterion +
        ": " +
        (formatFailureCategories(m.failureCategories, l) || "the review did not complete") +
        ".",
    ),
  evidence_failure: (m, l) =>
    localized(
      l,
      `暂时无法判断“${m.criterion}”：${evidenceFinding(m, l)}`,
      `Unable to determine ${m.criterion}: ${evidenceFinding(m, l)}`,
    ),
  measurement_failure: (m, l) =>
    localized(
      l,
      `暂时无法判断“${m.criterion}”：评审发现${formatFailureCategories(m.failureCategories, l)}。`,
      "Unable to determine " +
        m.criterion +
        ": review issues were reported (" +
        formatFailureCategories(m.failureCategories, l) +
        ").",
    ),
  unattributed_failure: (m, l) =>
    localized(
      l,
      `暂时无法判断“${m.criterion}”：评审过程中出现问题，原因未能确定。`,
      "Unable to determine " +
        m.criterion +
        ": a review problem occurred, but its cause is unknown.",
    ),
  abstention: (m, l) =>
    localized(
      l,
      "暂时无法判断“" +
        m.criterion +
        "”：Judge 返回了“未知 / 证据不足”，未能作出明确判断。" +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? `证据状态：${formatEvidenceStatuses(m.evidenceStatuses, l)}。`
          : "") +
        "请复核现有依据或重新评审；这不表示质量不合格。",
      "Unable to determine " +
        m.criterion +
        ": the judge returned an unknown or insufficient verdict and did not reach a clear conclusion." +
        (formatEvidenceStatuses(m.evidenceStatuses, l)
          ? ` Evidence status: ${formatEvidenceStatuses(m.evidenceStatuses, l)}.`
          : "") +
        " Review the current basis or rerun the review; this is not a quality failure.",
    ),
  indeterminate: (m, l) =>
    localized(
      l,
      `暂时无法判断“${m.criterion}”：现有信息不足以形成明确结论。`,
      "Unable to determine " +
        m.criterion +
        ": the available information is not sufficient to reach a clear conclusion.",
    ),
};

const actionTemplates: Record<
  ActionKey,
  (model: FindingPresentationModel, locale: GateLocale) => string
> = {
  evidence_remediation: (m, l) => {
    const statuses = new Set(m.evidenceStatuses.map((entry) => entry.status));
    const labels: Partial<Record<EvidenceStatus["status"], string>> =
      l === "zh-CN"
        ? {
            missing: "补充尚未采集的证据",
            unavailable: "恢复不可读取证据的访问",
            truncated: "必要时提供未截断的完整材料",
            contradiction: "核对相互矛盾的证据并确认如何解释冲突",
            unsupported: "核实内容矛盾或无法支持判断的证据",
          }
        : {
            missing: "collect the evidence that is missing",
            unavailable: "restore access to the unavailable evidence",
            truncated: "provide the complete, untruncated material if needed",
            contradiction: "review contradictory evidence and resolve or explain the conflict",
            unsupported: "review evidence that is contradictory or does not support the judgment",
          };
    const order: EvidenceStatus["status"][] = [
      "missing",
      "unavailable",
      "truncated",
      "contradiction",
      "unsupported",
    ];
    const actions = order
      .filter((status) => statuses.has(status))
      .map((status) => labels[status])
      .filter((value): value is string => value !== undefined);
    return l === "zh-CN"
      ? `${actions.join("，")}后重新评审。`
      : `${actions.join("; ")}, then rerun the review.`;
  },
  fix_optional: (_m, l) =>
    localized(
      l,
      "可按需要修复该项并重新评审；它不是必选阻塞项。",
      "You may address this item and rerun the review; it is not a mandatory blocker.",
    ),
  fix_required: (_m, l) =>
    localized(l, "修复该项并重新运行评审。", "Fix this requirement and rerun the review."),
  disagreement: (_m, l) =>
    localized(
      l,
      "复核分歧结果，或增加独立评审次数。",
      "Review the conflicting judgments or collect more independent reviews.",
    ),
  provider_failure: (_m, l) =>
    localized(
      l,
      "确认评审服务恢复后，重新运行未完成的评审。",
      "Restore the review service and rerun the incomplete evaluation.",
    ),
  execution_failure: (_m, l) =>
    localized(
      l,
      "检查评审失败记录后，重新运行未完成的评审。",
      "Review the recorded failure details and rerun the incomplete evaluation.",
    ),
  measurement_failure: (_m, l) =>
    localized(
      l,
      "根据列出的失败类别复核对应的结果或输入，再重新评审。",
      "Review the results or inputs indicated by the failure categories, then rerun.",
    ),
  abstention: (_m, l) =>
    localized(
      l,
      "复核本次判断及其依据；必要时增加独立评审或补充针对性材料。这不表示质量不合格。",
      "Review the judgment and its basis; collect another independent review or targeted evidence if needed. This is not a quality failure.",
    ),
  unsupported_citation: (_m, l) =>
    localized(
      l,
      "现有证据可读取；请核对评审引用是否对应本项要求，修正引用后重新评审。",
      "The evidence is readable; check that the review cites material relevant to this requirement, correct the citation, then rerun.",
    ),
  unsupported_evidence: (_m, l) =>
    localized(
      l,
      "核实无法支持判断的证据内容后重新评审。",
      "Review the evidence that does not support the judgment, then rerun.",
    ),
  unavailable_evidence: (_m, l) =>
    localized(
      l,
      "检查证据来源、访问权限或采集过程，确认材料可读取后重新评审。",
      "Check access to the evidence source or its collection, restore availability, then rerun the review.",
    ),
  missing_evidence: (_m, l) =>
    localized(
      l,
      "补充或核实尚未提供的证据后重新评审。",
      "Provide or verify the evidence that has not been collected, then rerun the review.",
    ),
  unattributed_failure: (_m, l) =>
    localized(
      l,
      "检查评审记录和相关输入；原因未确认前，不要把它当作品质量失败。",
      "Check the review record and its inputs; do not treat an unattributed failure as a quality failure.",
    ),
  none: (_m, l) => localized(l, "无需处理。", "No action required."),
};

export function renderFinding(
  model: FindingPresentationModel,
  locale: GateLocale,
): { readonly message: string; readonly nextStep: string } {
  let message = messageTemplates[model.messageKey](model, locale);
  const notes = [
    model.qualifiedDisagreement
      ? localized(
          locale,
          "重复评审存在分歧，当前结论达到预设一致比例。",
          "Repeated reviews disagree, but the result meets the configured agreement threshold.",
        )
      : undefined,
    model.ignoredFailureCategories.length > 0
      ? localized(
          locale,
          "部分重复评审未能使用：" +
            formatFailureCategories(model.ignoredFailureCategories, locale) +
            "。",
          "Some repeated reviews could not be used: " +
            formatFailureCategories(model.ignoredFailureCategories, locale) +
            ".",
        )
      : undefined,
    model.partialEvidenceStatuses.length > 0
      ? localized(
          locale,
          "部分重复评审的证据状态：" +
            formatEvidenceStatuses(model.partialEvidenceStatuses, locale) +
            "。",
          "Evidence status across repeated reviews: " +
            formatEvidenceStatuses(model.partialEvidenceStatuses, locale) +
            ".",
        )
      : undefined,
  ].filter((note): note is string => note !== undefined);
  if (notes.length > 0) message = `${message} ${notes.join(" ")}`;
  return { message, nextStep: actionTemplates[model.actionKey](model, locale) };
}

export function renderSummary(
  outcome: GateDecision["qualityOutcome"],
  mode: GateDecision["executionMode"],
  locale: GateLocale,
): string {
  const result =
    outcome === "pass"
      ? localized(locale, "通过", "Pass")
      : outcome === "fail"
        ? localized(locale, "未通过", "Fail")
        : localized(locale, "暂时无法判断", "Unable to determine");
  const prefix =
    mode === "enforced"
      ? localized(locale, "自动把关", "Enforced review")
      : mode === "diagnostic"
        ? localized(
            locale,
            "诊断评审（仅供参考，不会阻止流程）",
            "Diagnostic review (non-blocking)",
          )
        : mode === "indeterminate"
          ? localized(locale, "暂时无法自动把关", "Automatic review unavailable")
          : localized(locale, "参考评审（不会阻止流程）", "Advisory review (non-blocking)");
  return locale === "zh-CN" ? `${prefix}：${result}。` : `${prefix}: ${result}.`;
}

export function renderNotApplicableFinding(
  criterion: Criterion,
  locale: GateLocale,
): GateDecision["findings"][number] {
  return {
    criterionId: criterion.id,
    criterionDescription: criterion.description,
    outcome: criterion.mandatory ? "indeterminate" : "advisory",
    reason: "not_applicable",
    message: localized(
      locale,
      `“${criterion.description}”尚未配置适用于当前任务类型和证据形态的评审范围。`,
      `No review scope is configured for ${criterion.description} with this task class and evidence shape.`,
    ),
    evidenceIds: [],
    requiredEvidenceIds: [],
    nextStep: localized(
      locale,
      "为该任务范围配置评审策略并完成校准。",
      "Configure and calibrate a policy for this task scope.",
    ),
  };
}

export type ReviewGateReason =
  | "calibration_unavailable"
  | "calibration_unverified"
  | "request_mismatch"
  | "response_metadata_missing"
  | "response_model_unknown"
  | "response_model_conflict"
  | "finish_reason_unknown"
  | "prompt_identity_unknown"
  | "prompt_identity_conflict"
  | "render_identity_conflict"
  | "execution_complete"
  | "execution_partial"
  | "execution_failed"
  | "execution_cancelled"
  | "execution_not_started";

const REASON_LABELS: Readonly<
  Record<ReviewGateReason, { readonly zh: string; readonly en: string }>
> = {
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

export function reviewReasonLabel(reason: ReviewGateReason, locale: GateLocale): string {
  const labels = REASON_LABELS[reason];
  return locale === "en-US" ? labels.en : labels.zh;
}

export function renderReviewExplanation(
  completeness: import("./review/types.js").ReviewCompleteness,
  quality: GateDecision["qualityOutcome"],
  eligibility: boolean,
  locale: GateLocale,
  reasons: readonly ReviewGateReason[],
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
        : `Notes: ${reasons.map((reason) => reviewReasonLabel(reason, locale)).join(", ")}.`,
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
      : `说明：${reasons.map((reason) => reviewReasonLabel(reason, locale)).join("、")}。`,
  ]
    .filter((part) => part.length > 0)
    .join("");
}
