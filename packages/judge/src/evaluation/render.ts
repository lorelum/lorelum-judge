import { stripVTControlCharacters } from "node:util";
import type {
  CodeEvaluationReport,
  CodeLocation,
  CodeSourceItem,
  SourceIssue,
} from "@lorelum/judge-protocol";
import { CODE_STANDARDS } from "./plan.js";

export const CODE_REPORT_RENDERER_VERSION = "lorelum.judge.code-report-renderer/v1";

const severity = { high: "重要影响", medium: "局部影响", low: "有限影响" } as const;
const attribution = {
  introduced: "本次变更引入",
  amplified: "本次变更扩大或暴露的原有风险",
  pre_existing: "上下文中的既有问题",
  undetermined: "尚不能确定是否由本次变更引入",
  not_applicable: "",
} as const;
const followUp = {
  supported: "意见成立",
  conditional: "在说明的条件下成立",
  unsupported: "现有依据不支持该意见",
  unresolved: "尚无法确认",
  resolved: "本次代码中原问题已不存在",
  persists: "原问题仍存在",
} as const;

function plain(value: string): string {
  return stripVTControlCharacters(value).replace(/\p{Cc}/gu, (character) =>
    character === "\n" || character === "\t" ? character : "",
  );
}

function sourceName(item: CodeSourceItem): string {
  if (item.path === "snippet" && item.provenance === "provided") return "代码片段";
  if (item.path === "user" && item.role === "requirement") return "用户明确要求";
  if (item.role === "opinion" && item.path.startsWith("用户意见 "))
    return plain(item.text.split("\n")[0] ?? item.path);
  return plain(item.path);
}

function versionText(version: string): string {
  if (/^[a-f0-9]{40,64}$/i.test(version)) return version.slice(0, 12);
  if (version.startsWith("index:")) return "捕获的暂存区";
  if (version.startsWith("working")) return "捕获的工作区";
  if (version === "empty-tree") return "无旧版本";
  return "提供的内容快照";
}

const messages: Record<string, string> = {
  patch_only: "只取得了提供的 diff；新旧侧位置由 diff 声明，不表示已读取完整文件。",
  source_changed: "读取期间观察到来源更新，不能把本次结果当作最新版本的完整结论。",
  disclosure_not_authorized: "尚未获准将读取的内容发送给所配置模型，因此没有进行模型评价。",
  outside_root: "补查路径超出允许读取的目录，未读取该内容。",
  repository_not_authorized: "该仓库不在允许读取的范围内。",
  ambiguous_ref: "链接存在多个有效的版本与路径解释，尚不能确定评价对象。",
  cancelled: "读取或评价已取消。",
  timeout: "评价超过设定时限，尚未完成。",
  verification_unavailable: "未能完成来源核验；这不表示已证实内容变化，也不能保证来源仍是最新。",
  binary_or_encoding: "材料不是可读取的 UTF-8 文本，未作代码评价。",
  binary_unavailable: "二进制内容未作文本代码评价。",
  symlink: "未跟随目录或文件链接。",
  symlink_not_followed: "未跟随仓库中的文件链接。",
  submodule_unavailable: "仅观察到子模块引用，未进入子模块评价。",
  lfs_unavailable: "只取得 LFS 指针，未取得其引用的内容。",
  lfs_pointer: "只取得 LFS 指针，未取得其引用的内容。",
  http_404: "资料不存在或当前访问权限不足，未能取得。",
  http_403: "来源服务拒绝访问，可能缺少权限或达到访问限制。",
  http_429: "来源服务限制了请求频率。",
  network_unavailable: "来源服务连接失败。",
};
function issueText(issue: SourceIssue): string {
  const known = messages[issue.code];
  if (known !== undefined) return known;
  if (issue.code.includes("limit") || issue.code.includes("incomplete"))
    return "读取达到限制或未能完成，相关内容未被完整检查。";
  if (/[\u3400-\u9fff]/.test(issue.message)) return plain(issue.message);
  return "部分资料或结果未能取得或核实，不能据此确认相关检查已完成。";
}

function locationText(location: CodeLocation, report: CodeEvaluationReport): string {
  const item = report.source.items.find((entry) => entry.id === location.itemId);
  if (item === undefined) return "位置无法核实";
  const side = item.side === "old" ? "旧侧" : item.side === "new" ? "新侧" : "当前内容";
  const lines =
    location.startLine === location.endLine
      ? `${location.startLine}`
      : `${location.startLine}–${location.endLine}`;
  return `${sourceName(item)}第 ${lines} 行${side === "当前内容" ? "" : `（${side}）`}`;
}

/** Render only the recorded report: no model call, scoring or repair suggestions. */
export function renderCodeEvaluation(report: CodeEvaluationReport): string {
  const lines: string[] = ["## 整体情况", ""];
  if (report.status === "cancelled")
    lines.push("本次评价已取消。以下如有结果，仅为取消前取得的部分内容。");
  else if (report.status === "failed") lines.push("本次评价未完成，不能据此判断代码没有问题。");
  else if (report.status === "partial")
    lines.push("本次评价存在未完成或无法判断的内容，不能视为完整检查。");
  const result = report.result;
  const problems = result?.problems ?? [];
  if (problems.some((problem) => problem.severity === "high")) {
    lines.push(
      `发现 ${problems.filter((problem) => problem.severity === "high").length} 项重要影响问题，详见下方依据。`,
    );
  }
  if (result !== undefined) {
    for (const summary of result.summary) lines.push(plain(summary.text));
    if (report.status === "completed" && problems.length === 0 && result.pending.length === 0) {
      lines.push("在本次已检查范围内，未记录有充分依据的问题；这不代表代码没有缺陷。");
    }
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  for (const problem of [...problems].sort(
    (left, right) => rank[left.severity] - rank[right.severity],
  )) {
    lines.push("", `### ${plain(problem.title)}`, "", `影响程度：${severity[problem.severity]}`);
    if (attribution[problem.attribution]) lines.push(`归因：${attribution[problem.attribution]}`);
    lines.push(
      `位置：${problem.locations.map((location) => locationText(location, report)).join("；") || "尚未定位"}`,
    );
    lines.push(
      `成立条件：${plain(problem.condition)}`,
      `影响：${plain(problem.impact)}`,
      `依据：${plain(problem.rationale)}`,
    );
  }
  if (result !== undefined && result.followUps.length > 0) {
    lines.push("", "## 意见核实与问题复查", "");
    for (const [index, observation] of result.followUps.entries()) {
      const original = report.source.items.find(
        (item) =>
          item.id === observation.reference ||
          (item.id.startsWith("previous:") &&
            item.text.includes(JSON.stringify(observation.reference))),
      );
      const label = original === undefined ? `待核实事项 ${index + 1}` : sourceName(original);
      lines.push(`- ${label}：${followUp[observation.outcome]}。${plain(observation.rationale)}`);
    }
  }
  if (result !== undefined && result.pending.length > 0) {
    lines.push("", "## 待核实事项", "");
    for (const pending of result.pending)
      lines.push(`- ${plain(pending.question)}：${plain(pending.reason)}`);
  }
  lines.push("", "## 检查范围与限制", "");
  const target = report.source.items.filter((item) => item.role === "target");
  lines.push(
    `评价对象：${
      target
        .map((item) => {
          const shown = report.execution?.shownLines?.[item.id];
          const projection =
            shown === undefined
              ? "未生成正式投影"
              : item.endLine === 0
                ? "空内容"
                : shown.length === 0
                  ? "无完整可见行"
                  : `第 ${shown[0]}–${shown.at(-1)} 完整行`;
          return `${sourceName(item)}（${item.side === "old" ? "修改前，" : item.side === "new" ? "修改后，" : ""}已取得${item.endLine === 0 ? "空内容" : `第 ${item.startLine}–${item.endLine} 行`}；正式投影：${projection}）`;
        })
        .join("；") || "未取得可评价对象"
    }`,
  );
  const context = report.source.items.filter((item) => item.role !== "target");
  if (context.length > 0)
    lines.push(
      `参考资料：${context.map(sourceName).join("；")}。补读资料不表示已完整评价这些文件。`,
    );
  for (const comparison of report.source.comparisons)
    lines.push(
      `前后对照：${versionText(comparison.mergeBase ?? comparison.base)} → ${versionText(comparison.head)}。`,
    );
  for (const limitation of new Set(report.limitations)) lines.push(`- ${plain(limitation)}`);
  for (const issue of report.issues) lines.push(`- ${issueText(issue)}`);
  if (report.source.omitted.length > 0)
    lines.push(`- 未覆盖：${report.source.omitted.map(plain).join("；")}`);
  lines.push("- 本次未执行候选代码或测试；测试源码不等于测试通过。评价不构成修改或交付授权。");
  if (report.plan !== undefined) {
    lines.push("", "## 本次采用的标准", "");
    for (const criterion of report.plan.definition.criteria) {
      const source =
        criterion.source?.origin === "policy"
          ? "默认标准"
          : report.source.items.find((item) => item.id === criterion.source?.ref);
      lines.push(
        `- ${plain(criterion.description)}（${typeof source === "string" ? source : source === undefined ? "明确要求" : sourceName(source)}）`,
      );
    }
    for (const excluded of report.plan.excluded)
      lines.push(
        `- 未检查${CODE_STANDARDS.find((standard) => standard.id === excluded.id)?.title ?? "额外项目"}：${plain(excluded.reason)}`,
      );
  }
  return `${lines.join("\n")}\n`;
}
