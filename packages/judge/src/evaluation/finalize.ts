import {
  type CodeEvaluationCompletionReason,
  type CodeEvaluationReport,
  deriveCodeEvaluationCompletion,
  identityOf,
  type SourceIssue,
  type SourceSnapshot,
  type ValidationResult,
  validateCodeEvaluationReport,
} from "@lorelum/judge-protocol";

export type EvaluationStage = "sources" | "preparation" | "evaluation";
export type CodeEvaluationDraft = Omit<
  CodeEvaluationReport,
  "status" | "issues" | "limitations" | "sourceIdentity"
>;
export interface EvaluationObservations {
  readonly issues: readonly SourceIssue[];
  readonly stop?: {
    readonly kind: "failed" | "cancelled" | "timeout";
    readonly stage: EvaluationStage;
  };
  readonly freshness?: Pick<SourceSnapshot, "consistent" | "issues">;
}

const limitations: Record<CodeEvaluationCompletionReason, string> = {
  missing_target: "未取得可评价的代码对象。",
  missing_result: "未形成可用的正式评价结果，不能据此判断代码没有问题。",
  execution_incomplete: "正式评价包含未完成、失败或未执行的尝试。",
  source_changed: "观察到来源变化；结论仅对应报告中固定的版本，不代表当前最新内容。",
  source_omitted: "存在未读取或未覆盖的来源内容。",
  material_incomplete: "部分材料仅包含提供的 patch 或选定行范围，不表示已检查完整文件。",
  projection_limited: "正式评价的证据投影存在截断或未展示材料；已读取内容不等于已完整覆盖目标。",
  judgment_unknown: "部分判断仍为无法判断或依据不足，评价目标未全部完成。",
  pending_observation: "仍有待核实的事项或缺失前提，评价目标未全部完成。",
  unresolved_follow_up: "部分意见或原问题仍无法核实，不能视为核实或复查已经完成。",
  missing_follow_up: "指定的意见或原问题没有唯一有效的核实结果。",
  unexpected_follow_up: "结果包含未请求的意见或原问题引用。",
  diagnostic: "存在未能完成的来源读取、核验或结果验证，不能视为完整检查。",
  operation_failed: "本次请求有未能完整完成的执行步骤。",
  timeout: "本次评价超过总时限，未完整完成。",
  cancelled: "本次请求已取消；已有结果仅是取消前取得的观察。",
};

/** Assemble the immutable measured snapshot and later observations, then finalize once. */
export function finalizeCodeEvaluationReport(
  draft: CodeEvaluationDraft,
  observations: EvaluationObservations,
): ValidationResult<CodeEvaluationReport> {
  const issues: SourceIssue[] = [];
  const seen = new Set<string>();
  for (const entries of [
    draft.source.issues,
    observations.issues,
    observations.freshness?.issues,
  ]) {
    if (entries === undefined) continue;
    for (const entry of entries) {
      const key = JSON.stringify([entry.code, entry.source, entry.message, entry.fatal ?? false]);
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(entry);
      }
    }
  }
  if (
    observations.freshness?.consistent === false &&
    !issues.some((entry) => entry.code === "source_changed")
  )
    issues.push({ code: "source_changed", message: "最终核验观察到来源变化。" });
  const stop = observations.stop;
  if (stop !== undefined && (stop.kind !== "failed" || !issues.some((entry) => entry.fatal))) {
    issues.push({
      code: stop.kind === "failed" ? `${stop.stage}_failed` : stop.kind,
      message:
        stop.kind === "timeout"
          ? "本次评价超过总时限，未完整完成。"
          : stop.kind === "cancelled"
            ? "本次请求已取消。"
            : `本次${stop.stage === "sources" ? "来源取得" : stop.stage === "preparation" ? "评价准备" : "评价执行"}未能完整完成；不能据此判断代码没有问题。`,
      fatal: draft.execution === undefined,
    });
  }
  const completion = deriveCodeEvaluationCompletion({ ...draft, issues });
  for (const reference of completion.missingFollowUps)
    issues.push({
      code: "missing_follow_up",
      message: "指定的意见或原问题没有唯一有效的核实结果。",
      source: reference,
    });
  for (const reference of completion.unexpectedFollowUps)
    issues.push({
      code: "unknown_follow_up",
      message: "核实结果引用了未请求的原意见或问题。",
      source: reference,
    });

  const sourceId = identityOf(draft.source.schema, draft.source);
  if (!sourceId.ok)
    return {
      ok: false,
      issues: [
        { path: "$.source", code: "schema", message: `source identity: ${sourceId.error.reason}` },
      ],
    };
  return validateCodeEvaluationReport({
    ...draft,
    sourceIdentity: sourceId.identity,
    status: completion.status,
    issues,
    limitations: completion.reasons.map((reason) => limitations[reason]),
  });
}
