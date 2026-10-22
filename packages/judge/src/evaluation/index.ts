import { randomUUID } from "node:crypto";
import {
  type CodeEvaluationReport,
  type CodeSourceItem,
  type CodeSourceRole,
  type CodeTarget,
  codeEvaluationReportIdentity,
  identityOf,
  type PreparationRecord,
  type ReviewPlan,
  reviewPlanIdentity,
  type SourceSnapshot,
  snapshot,
  sourceSnapshotIdentity,
  validateCodeEvaluationReport,
  validateCodeTarget,
} from "@lorelum/judge-protocol";
import { executeCodeReview } from "../review/index.js";
import { validateMethod } from "../review/method.js";
import { collectCodeSources } from "../sources/index.js";
import type { SourceSession } from "../sources/types.js";
import { isRecord } from "../type-guards.js";
import { evaluationEvidence, makeEvaluationPlan } from "./plan.js";
import { type ContextSelection, prepareEvaluation } from "./prepare.js";
import { CODE_REPORT_RENDERER_VERSION, renderCodeEvaluation } from "./render.js";
import type { EvaluateCodeInput, EvaluateCodeResult, EvaluationPorts } from "./types.js";

function normalizeTarget(target: CodeTarget | string): CodeTarget {
  if (typeof target === "string") {
    if (!target.trim()) throw new Error("target must not be empty");
    return /^https?:\/\//i.test(target)
      ? { kind: "github", url: target }
      : { kind: "local", path: target };
  }
  const checked = validateCodeTarget(target);
  if (!checked.ok) throw new Error("target must be a valid source selector");
  return checked.value;
}

function mergeSources(
  sessions: readonly SourceSession[],
  roles: readonly (CodeSourceRole | undefined)[],
): SourceSnapshot {
  const merged: SourceSnapshot = {
    schema: "lorelum.judge.source-snapshot/v1",
    items: [],
    issues: [],
    discovered: [],
    omitted: [],
    comparisons: [],
    consistent: true,
  };
  const ids = new Map<string, CodeSourceItem>();
  const priority: Record<CodeSourceRole, number> = {
    context: 0,
    opinion: 1,
    requirement: 2,
    target: 3,
  };
  for (const [index, session] of sessions.entries()) {
    const source = session.snapshot;
    merged.consistent &&= source.consistent;
    merged.issues.push(...source.issues);
    merged.discovered.push(...source.discovered);
    merged.omitted.push(...source.omitted);
    merged.comparisons.push(...source.comparisons);
    for (const item of source.items) {
      const role = item.role === "opinion" ? "opinion" : (roles[index] ?? item.role);
      const previous = ids.get(item.id);
      if (previous === undefined) {
        const copy = { ...item, role };
        ids.set(item.id, copy);
        merged.items.push(copy);
      } else if (
        previous.contentIdentity !== item.contentIdentity ||
        previous.text !== item.text ||
        previous.version !== item.version
      ) {
        merged.consistent = false;
        merged.issues.push({
          code: "source_identity_conflict",
          message: "The same source item identifier describes different material",
          source: item.path,
          fatal: true,
        });
      } else if (priority[role] > priority[previous.role]) previous.role = role;
    }
  }
  merged.discovered = [...new Set(merged.discovered)];
  merged.omitted = [...new Set(merged.omitted)];
  return merged;
}

function addReference(
  source: SourceSnapshot,
  id: string,
  text: string,
  role: "opinion" | "requirement",
  name: string,
): void {
  const content = identityOf("lorelum.judge.provided-reference/v1", text);
  if (!content.ok) throw new Error("invalid reference text");
  const lines = text === "" ? 0 : text.split("\n").length;
  source.items.push({
    id,
    path: name,
    text,
    role,
    side: "current",
    version: content.identity,
    contentIdentity: content.identity,
    startLine: 1,
    endLine: lines,
    complete: true,
    provenance: "provided",
  });
}

function normalizeRequirements(
  input: EvaluateCodeInput,
): { id: string; text: string; source: string }[] {
  return (input.requirements ?? []).map((requirement, index) => {
    const text = typeof requirement === "string" ? requirement : requirement.text;
    const source = typeof requirement === "string" ? "user" : (requirement.source ?? "user");
    if (typeof text !== "string" || !text.trim() || typeof source !== "string" || !source.trim())
      throw new Error("requirements need text and a source");
    return { id: `explicit-${index + 1}`, text, source };
  });
}

/** One high-level evaluation. Sources and preparation are explicit, bounded, and read-only. */
export async function evaluateCode(
  raw: EvaluateCodeInput,
  ports: EvaluationPorts,
): Promise<EvaluateCodeResult> {
  let input: EvaluateCodeInput;
  let target: CodeTarget;
  let explicitRequirements: { id: string; text: string; source: string }[];
  try {
    if (!isRecord(raw)) throw new Error("input must be an object");
    input = snapshot(raw) as unknown as EvaluateCodeInput;
    target = normalizeTarget(input.target);
    if (input.request !== undefined && (typeof input.request !== "string" || !input.request.trim()))
      throw new Error("request must be non-empty text");
    if (
      input.id !== undefined &&
      (typeof input.id !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(input.id))
    )
      throw new Error("id must use letters, digits, dots, underscores, colons or hyphens");
    if (input.context !== undefined && !Array.isArray(input.context))
      throw new Error("context must be an array");
    if (input.requirementSources !== undefined && !Array.isArray(input.requirementSources))
      throw new Error("requirementSources must be an array");
    if (input.requirements !== undefined && !Array.isArray(input.requirements))
      throw new Error("requirements must be an array");
    if (
      input.opinions !== undefined &&
      (!Array.isArray(input.opinions) ||
        input.opinions.some(
          (opinion) =>
            !isRecord(opinion) ||
            typeof opinion.id !== "string" ||
            !/^[A-Za-z0-9_.:-]+$/.test(opinion.id) ||
            typeof opinion.text !== "string" ||
            !opinion.text.trim() ||
            (opinion.source !== undefined && typeof opinion.source !== "string"),
        ))
    )
      throw new Error("opinions need unique identifiers and text");
    if (
      new Set((input.opinions ?? []).map((opinion) => opinion.id)).size !==
      (input.opinions?.length ?? 0)
    )
      throw new Error("duplicate opinion id");
    if (input.previousReport !== undefined) {
      const previous = validateCodeEvaluationReport(input.previousReport);
      if (!previous.ok) throw new Error("previousReport is not a valid evaluation report");
    }
    explicitRequirements = normalizeRequirements(input);
    if (ports.method?.kind !== "llm" || ports.model === undefined)
      throw new Error("an LLM model and explicit method configuration are required");
    const method = validateMethod(ports.method);
    if (!method.ok || method.value.kind !== "llm")
      throw new Error("invalid model method configuration");
    ports = { ...ports, method: method.value, limits: { ...ports.limits } };
    if (ports.signal !== undefined && !(ports.signal instanceof AbortSignal))
      throw new Error("invalid cancellation signal");
    if (
      ports.timeoutMs !== undefined &&
      (!Number.isSafeInteger(ports.timeoutMs) || ports.timeoutMs < 1)
    )
      throw new Error("timeout must be a positive integer");
    const rounds = ports.limits?.maxContextRounds ?? 2;
    const reads = ports.limits?.maxRequestsPerRound ?? 8;
    const budget = ports.limits?.evidenceBudget ?? 180_000;
    if (
      !Number.isSafeInteger(rounds) ||
      rounds < 0 ||
      rounds > 8 ||
      !Number.isSafeInteger(reads) ||
      reads < 1 ||
      reads > 64 ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 180_000
    )
      throw new Error("invalid evaluation limits");
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid_input",
          message: error instanceof Error ? error.message : "invalid evaluation input",
        },
      ],
    };
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort("user_cancelled");
  ports.signal?.addEventListener("abort", abort, { once: true });
  if (ports.signal?.aborted) abort();
  const timer =
    ports.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort("evaluation_timeout");
        }, ports.timeoutMs);
  const request =
    input.request ?? "检查所提供代码中有依据的问题，说明整体状况、具体影响与未检查内容。";
  const preparation: PreparationRecord[] = [];
  const sessions: SourceSession[] = [];
  const roles: (CodeSourceRole | undefined)[] = [];
  let source: SourceSnapshot = {
    schema: "lorelum.judge.source-snapshot/v1",
    items: [],
    issues: [],
    discovered: [],
    omitted: [],
    comparisons: [],
    consistent: true,
  };
  const report: CodeEvaluationReport = {
    schema: "lorelum.judge.code-evaluation-report/v1",
    id: input.id ?? `evaluation-${randomUUID()}`,
    status: "failed",
    request,
    source,
    sourceIdentity: "",
    preparation,
    issues: [],
    limitations: [],
    rendererVersion: CODE_REPORT_RENDERER_VERSION,
  };
  let phase = "sources";
  try {
    const selectors = [
      target,
      ...(input.context ?? []).map(normalizeTarget),
      ...(input.requirementSources ?? []).map(normalizeTarget),
    ];
    const contextEnd = 1 + (input.context?.length ?? 0);
    const sourceOptions = {
      ...ports.sources,
      ...(ports.sources?.roots === undefined ? {} : { roots: [...ports.sources.roots] }),
      ...(ports.sources?.github === undefined
        ? {}
        : {
            github: {
              ...ports.sources.github,
              ...(ports.sources.github.repositories === undefined
                ? {}
                : { repositories: [...ports.sources.github.repositories] }),
            },
          }),
      limits: { ...ports.sources?.limits },
      signal: controller.signal,
    };
    for (const [index, selector] of selectors.entries()) {
      if (controller.signal.aborted) throw new Error("cancelled");
      sessions.push(await collectCodeSources(selector, sourceOptions));
      roles.push(index === 0 ? undefined : index < contextEnd ? "context" : "requirement");
    }
    const references: {
      id: string;
      text: string;
      role: "requirement" | "opinion";
      name: string;
    }[] = [];
    for (const requirement of explicitRequirements)
      references.push({
        id: `explicit:${requirement.id}`,
        text: requirement.text,
        role: "requirement",
        name: requirement.source,
      });
    for (const opinion of input.opinions ?? [])
      references.push({
        id: `opinion:${opinion.id}`,
        text: opinion.text,
        role: "opinion",
        name: opinion.source ?? `用户意见 ${opinion.id}`,
      });
    const requiredFollowUps: string[] = (input.opinions ?? []).map(
      (opinion) => `opinion:${opinion.id}`,
    );
    if (input.previousReport !== undefined) {
      const previousIdentity = codeEvaluationReportIdentity(input.previousReport);
      if (!previousIdentity.ok) throw new Error("invalid previous report identity");
      report.previousReportIdentity = previousIdentity.identity;
      for (const problem of input.previousReport.result?.problems ?? []) {
        const reference = `${previousIdentity.identity}:${problem.id}`;
        requiredFollowUps.push(reference);
        references.push({
          id: `previous:${problem.id}`,
          text: JSON.stringify({
            reference,
            problem,
            originalSourceIdentity: input.previousReport.sourceIdentity,
          }),
          role: "opinion",
          name: `前次问题：${problem.title}`,
        });
      }
    }
    const refresh = () => {
      source = mergeSources(sessions, roles);
      for (const reference of references)
        addReference(source, reference.id, reference.text, reference.role, reference.name);
      report.source = source;
    };
    refresh();
    if (!source.items.some((item) => item.role === "target"))
      throw new Error("no target material available");
    if (source.issues.some((issue) => issue.fatal)) throw new Error("source acquisition failed");
    // Even an empty comparison exposes inventory and can yield external context later.
    const external = selectors.some(
      (selector) =>
        selector.kind === "local" || selector.kind === "git" || selector.kind === "github",
    );
    if (external && ports.allowModelDisclosure !== true) {
      report.issues.push({
        code: "disclosure_not_authorized",
        message: "读取来源内容尚未获准发送给所配置模型；调用方须显式允许模型披露。",
        fatal: true,
      });
      throw new Error("source disclosure not authorized");
    }
    phase = "preparation";
    const preparationPorts: EvaluationPorts = { ...ports, signal: controller.signal };
    let selection: ContextSelection | undefined;
    const maxRounds = ports.limits?.maxContextRounds ?? 2;
    const taskRequest = `${request}\n\n显式要求（必须保留，不得由模型排除）：${JSON.stringify(explicitRequirements)}\n需逐条核实/复查的引用：${JSON.stringify(requiredFollowUps)}`;
    for (let round = 0; round <= maxRounds; round += 1) {
      if (controller.signal.aborted) throw new Error("cancelled");
      selection = await prepareEvaluation(
        taskRequest,
        source,
        selectors.map((selector, index) => ({ index, target: selector })),
        preparationPorts,
        controller.signal,
        preparation,
        round,
        round < maxRounds,
      );
      if (selection.reads.length === 0) break;
      for (const read of selection.reads) {
        if (controller.signal.aborted) throw new Error("cancelled");
        await sessions[read.session]?.read(read.request);
      }
      refresh();
    }
    if (selection === undefined) throw new Error("preparation returned no plan");
    const requirements = [...explicitRequirements];
    for (const requirement of selection.requirements) {
      const origin =
        requirement.source === "user"
          ? request
          : source.items.find(
              (item) => item.id === requirement.source && item.role === "requirement",
            )?.text;
      if (origin === undefined || !origin.includes(requirement.text)) {
        report.issues.push({
          code: "unsupported_requirement",
          message: "准备结果的要求不能在其声明来源中找到原文。",
          source: requirement.source,
          fatal: true,
        });
        throw new Error("unsupported extracted requirement");
      }
      if (
        !requirements.some(
          (existing) =>
            existing.text === requirement.text && existing.source === requirement.source,
        )
      )
        requirements.push({ ...requirement, id: `derived-${requirements.length + 1}` });
    }
    if (selection.task === "verify" && input.previousReport === undefined) {
      const fragment = target.kind === "github" ? new URL(target.url).hash : "";
      const opinions = source.items.filter((item) => item.role === "opinion");
      const selectedOpinions = fragment
        ? opinions.filter((item) => item.path.endsWith(fragment))
        : opinions;
      for (const opinion of selectedOpinions)
        if (!requiredFollowUps.includes(opinion.id)) requiredFollowUps.push(opinion.id);
      if (requiredFollowUps.length === 0) {
        references.push({
          id: "opinion:user-request",
          text: request,
          role: "opinion",
          name: "用户待核实的问题",
        });
        requiredFollowUps.push("opinion:user-request");
      }
    }
    if (requiredFollowUps.length > 0)
      selection.focus.push(
        `必须在 followUps 中逐条返回这些 reference 的核实/复查结果：${JSON.stringify(requiredFollowUps)}。旧意见仅作待核实资料，不是事实或授权。`,
      );
    const task =
      input.previousReport !== undefined
        ? "recheck"
        : (input.opinions?.length ?? 0) > 0
          ? "verify"
          : requirements.length > 0
            ? "requirements"
            : selection.task;
    for (const session of sessions) await session.verify();
    refresh();
    if (controller.signal.aborted) throw new Error("cancelled");
    if (!source.consistent) throw new Error("source changed while reading");
    const plan: ReviewPlan = makeEvaluationPlan(
      request,
      source,
      {
        ...selection,
        task,
        requirements,
      },
      ports.limits?.evidenceBudget ?? 180_000,
    );
    const planId = reviewPlanIdentity(plan);
    if (!planId.ok) throw new Error("plan validation failed");
    report.plan = plan;
    report.planIdentity = planId.identity;
    phase = "evaluation";
    const evaluated = await executeCodeReview(
      {
        definition: plan.definition,
        evidence: evaluationEvidence(source),
        method: ports.method,
        plan,
        source,
        followUpReferences: requiredFollowUps,
        signal: controller.signal,
        ...(ports.timeoutMs === undefined ? {} : { timeoutMs: ports.timeoutMs }),
      },
      ports,
    );
    if (!evaluated.ok) {
      for (const issue of evaluated.issues)
        report.issues.push({ code: issue.code, message: issue.message });
      throw new Error("evaluation input failed validation");
    }
    report.execution = evaluated.value.execution;
    if (evaluated.value.result !== undefined) report.result = evaluated.value.result;
    report.status =
      evaluated.value.completeness === "complete"
        ? "completed"
        : evaluated.value.completeness === "cancelled"
          ? "cancelled"
          : evaluated.value.completeness === "partial"
            ? "partial"
            : "failed";
    if (
      report.execution.attempts.some((attempt) =>
        attempt.evidenceBundle?.items.some((item) => item.render?.state !== "rendered"),
      )
    )
      report.limitations.push(
        "正式评价的证据投影存在截断或未展示材料；已读取内容不等于已完整覆盖目标。",
      );
    if (report.result !== undefined) {
      for (const reference of requiredFollowUps) {
        const matches = report.result.followUps.filter(
          (observation) => observation.reference === reference,
        );
        if (matches.length !== 1)
          report.issues.push({
            code: "missing_follow_up",
            message: "指定的意见或原问题没有唯一有效的核实结果。",
            source: reference,
          });
      }
      for (const followUp of report.result.followUps)
        if (!requiredFollowUps.includes(followUp.reference) && requiredFollowUps.length > 0)
          report.issues.push({
            code: "unknown_follow_up",
            message: "核实结果引用了未请求的原意见或问题。",
            source: followUp.reference,
          });
      if (
        report.result.pending.length > 0 ||
        report.result.followUps.some((observation) => observation.outcome === "unresolved") ||
        report.result.verdicts.some(
          (verdict) => verdict.verdict === "unknown" || verdict.verdict === "insufficient",
        )
      )
        report.limitations.push("部分检查存在未解决前提或资料不足，不能视为目标已全部完成。");
    }
    for (const session of sessions) await session.verify();
    if (controller.signal.aborted) throw new Error("cancelled");
    const observed = mergeSources(sessions, roles);
    // Preserve exactly the source snapshot measured by the plan; later observations
    // describe freshness, not a replacement input for an already finished execution.
    if (!observed.consistent)
      report.limitations.push(
        "评价期间观察到来源更新；结论仅对应报告中固定的版本，不代表当前最新内容。",
      );
    for (const issue of observed.issues) {
      if (
        !source.issues.some(
          (existing) =>
            existing.code === issue.code &&
            existing.source === issue.source &&
            existing.message === issue.message,
        )
      )
        report.issues.push(issue);
    }
  } catch {
    report.status = timedOut
      ? "failed"
      : controller.signal.aborted
        ? "cancelled"
        : report.execution !== undefined && report.result !== undefined
          ? "partial"
          : "failed";
    if (!report.issues.some((issue) => issue.fatal))
      report.issues.push({
        code: timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : `${phase}_failed`,
        message: timedOut
          ? "本次评价超过总时限，未完整完成。"
          : controller.signal.aborted
            ? "本次请求已取消。"
            : `本次${phase === "sources" ? "来源取得" : phase === "preparation" ? "评价准备" : "评价执行"}未能完整完成；不能据此判断代码没有问题。`,
        fatal: report.execution === undefined,
      });
    if (sessions.length > 0 && report.source.items.length === 0)
      report.source = mergeSources(sessions, roles);
  } finally {
    clearTimeout(timer);
    ports.signal?.removeEventListener("abort", abort);
  }
  if (timedOut) {
    report.status = "failed";
    if (!report.issues.some((issue) => issue.code === "timeout"))
      report.issues.push({ code: "timeout", message: "本次评价超过总时限。" });
  }
  report.issues.push(...report.source.issues);
  if (!report.source.consistent)
    report.limitations.push("读取期间观察到来源变化，本报告不代表一致或最新的源版本。");
  if (report.source.omitted.length > 0) report.limitations.push("存在未读取或未覆盖的来源内容。");
  if (report.source.items.some((item) => !item.complete))
    report.limitations.push("部分材料仅包含提供的 patch 或选定行范围，不表示已检查完整文件。");
  if (
    report.status === "completed" &&
    (report.issues.length > 0 || report.limitations.length > 0 || !report.source.consistent)
  )
    report.status = "partial";
  const sourceId = sourceSnapshotIdentity(report.source);
  if (!sourceId.ok) return { ok: false, issues: sourceId.issues };
  report.sourceIdentity = sourceId.identity;
  const checked = validateCodeEvaluationReport(report);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  return { ok: true, value: checked.value, text: renderCodeEvaluation(checked.value) };
}

export { CODE_STANDARDS, CODE_STANDARDS_VERSION } from "./plan.js";
export { CODE_REPORT_RENDERER_VERSION, renderCodeEvaluation } from "./render.js";
export type {
  EvaluateCodeInput,
  EvaluateCodeResult,
  EvaluationLimits,
  EvaluationPorts,
} from "./types.js";
