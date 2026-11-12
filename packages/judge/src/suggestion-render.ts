import { stripVTControlCharacters } from "node:util";
import type { CodeSuggestionReport, SourceSnapshot } from "@lorelum/judge-protocol";

const labels = { required: "需要处理", optional: "可选优化", preference: "写法偏好" } as const;
const clean = (s: string) =>
  stripVTControlCharacters(s).replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""));

/** Deterministic presentation; model text is always untrusted and no check is represented as run. */
export function renderCodeSuggestions(
  report: CodeSuggestionReport,
  source: SourceSnapshot,
): string {
  const out = [
    "代码修改建议（仅供参考，不是修改授权）",
    `状态：${{ completed: "已生成", partial: "部分完成", failed: "生成失败", cancelled: "已取消" }[report.status]}`,
    "本报告仅针对评价保存的固定版本，未核验当前工作区或 PR；没有修改代码或运行检查。",
  ];
  for (const category of ["required", "optional", "preference"] as const) {
    const entries = report.result?.suggestions.filter((item) => item.category === category) ?? [];
    if (!entries.length) continue;
    out.push(`\n${labels[category]}：`);
    for (const item of entries) {
      const sourceItem = source.items.find((entry) => entry.id === item.location.itemId);
      out.push(
        `\n- ${clean(item.problem)}（问题 ${clean(item.problemId)}；依据 ${item.evidenceIds.map(clean).join("、")}）`,
        `  位置：${clean(sourceItem?.path ?? item.location.itemId)}:${item.location.startLine}-${item.location.endLine}，版本 ${clean(sourceItem?.version ?? "未知")}`,
        `  优先理由：${clean(item.priorityRationale)}`,
        `  建议：${clean(item.direction)}`,
        `  可能影响：${clean(item.impact)}`,
        `  检查方法（未执行）：${item.checks.map(clean).join("；")}`,
        `  未确定前提：${item.uncertainPremises.length ? item.uncertainPremises.map(clean).join("；") : "未列出"}`,
      );
      for (const alternative of item.alternatives)
        out.push(
          `  其他方案：${clean(alternative.direction)}；适用：${clean(alternative.applicability)}；代价：${clean(alternative.tradeoffs)}`,
        );
      if (item.example !== undefined)
        out.push(`  示例（未验证，仅在上述条件成立时参考）：\n${clean(item.example)}`);
    }
  }
  for (const omission of report.result?.omissions ?? [])
    out.push(
      `\n疑似遗漏，需补充评价：${clean(omission.description)}（依据 ${omission.evidenceIds.map(clean).join("、")}；${clean(omission.location.itemId)}:${omission.location.startLine}-${omission.location.endLine}）`,
    );
  for (const gap of report.gaps)
    out.push(
      `\n未完成${gap.problemId ? `（问题 ${clean(gap.problemId)}）` : ""}：${clean(gap.message)}`,
    );
  for (const limitation of report.limitations) out.push(`限制：${clean(limitation)}`);
  return out.join("\n");
}
