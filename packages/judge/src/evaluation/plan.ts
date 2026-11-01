import {
  projectCodeSource,
  type ReviewPlan,
  type SourceSnapshot,
  sourceSnapshotIdentity,
  validateMeasurementDefinitionV2,
} from "@lorelum/judge-protocol";
import type { EvidenceMaterial } from "../evidence.js";

export const CODE_STANDARDS_VERSION = "lorelum.judge.code-standards/v1";

export const CODE_STANDARDS = [
  {
    id: "behavior",
    title: "可见行为与明确约定",
    description: "检查可见控制流和数据处理是否违背明确约定；没有业务依据时不得发明预期行为。",
  },
  {
    id: "boundaries",
    title: "边界、失败与资源处理",
    description:
      "检查有依据的边界、失败路径和资源生命周期；调用方保证未知时应保留条件，不要求每个内部函数重复防御。",
  },
  {
    id: "security",
    title: "安全与数据一致性",
    description:
      "仅报告有代码路径和成立条件支持的越权、敏感信息泄漏或数据一致性问题；不因使用网络或数据库就认定风险。",
  },
  {
    id: "concurrency",
    title: "并发与状态",
    description: "检查有具体交错路径或状态转换依据的问题；不能仅因共享变量认定竞态。",
  },
  {
    id: "performance",
    title: "性能与资源规模",
    description: "性能判断须说明数据规模、资源或复杂度依据；未知负载不能推导实际性能不合格。",
  },
  {
    id: "maintenance",
    title: "具有实际影响的维护问题",
    description:
      "检查有具体影响的不一致或难以维护的规则；命名、格式、写法和设计模式偏好不构成缺陷，不凑优化建议。",
  },
] as const;

export type StandardId = (typeof CODE_STANDARDS)[number]["id"];

export function evaluationEvidence(source: SourceSnapshot): EvidenceMaterial[] {
  return source.items.map((item) => ({
    id: item.id,
    status: "present",
    text: projectCodeSource(item),
  }));
}

export interface PlanSelection {
  readonly task: ReviewPlan["task"];
  readonly focus: string[];
  readonly standards: string[];
  readonly requirements: { id: string; text: string; source: string }[];
  readonly excluded: { id: string; reason: string }[];
}

export function makeEvaluationPlan(
  request: string,
  source: SourceSnapshot,
  selection: PlanSelection,
  evidenceBudget = 180_000,
): ReviewPlan {
  const sourceId = sourceSnapshotIdentity(source);
  if (!sourceId.ok) throw new Error("source snapshot failed validation");
  const standards = CODE_STANDARDS.filter((standard) => selection.standards.includes(standard.id));
  const entries = [
    ...standards.map((standard) => ({
      id: standard.id,
      kind: "quality" as const,
      description: `${standard.title}：${standard.description}`,
      mandatory: false,
      source: { origin: "policy" as const, ref: `${CODE_STANDARDS_VERSION}:${standard.id}` },
      anchors: [
        {
          verdict: "strong" as const,
          description: "在实际已检查范围内，有充分依据满足本项标准；不表示项目无缺陷或运行已验证。",
        },
        {
          verdict: "adequate" as const,
          description:
            "已有依据支持基本满足，但存在应明确说明的有限不足；背景不足应使用 unknown/insufficient，不用中档代替。",
        },
        {
          verdict: "weak" as const,
          description: "有具体证据支持本项存在实质问题，须说明触发条件和影响；缺证不能记为不满足。",
        },
      ],
    })),
    ...selection.requirements.map((requirement) => ({
      id: requirement.id,
      kind: "contract" as const,
      description: requirement.text,
      mandatory: true,
      source: { origin: "user" as const, ref: requirement.source },
      anchors: [
        { verdict: "met" as const, description: "实际可见依据支持这条要求在声明范围内得到满足。" },
        {
          verdict: "unmet" as const,
          description: "实际可见依据表明这条要求不满足；须指出冲突行为与位置。",
        },
      ],
    })),
  ];
  if (entries.length === 0) throw new Error("no applicable evaluation criteria");
  const definition = {
    schema: "lorelum.judge.measurement-definition/v2",
    id: "code-evaluation",
    criteria: entries.map((entry, index) => ({
      schema: "lorelum.judge.criterion/v1",
      ...entry,
      evidence: source.items.map((item) => ({
        evidenceId: item.id,
        role: index === 0 ? "primary" : "reference",
      })),
    })),
    metadata: entries.map((entry) => ({ criterionId: entry.id, role: "advisory" })),
  };
  const checked = validateMeasurementDefinitionV2(definition);
  if (!checked.ok) throw new Error("evaluation criteria failed validation");
  return {
    schema: "lorelum.judge.review-plan/v1",
    request,
    task: selection.task,
    standardsVersion: CODE_STANDARDS_VERSION,
    definition: checked.value,
    sourceIdentity: sourceId.identity,
    evidenceBudget,
    requirements: selection.requirements,
    excluded: selection.excluded,
    focus: selection.focus,
  };
}
