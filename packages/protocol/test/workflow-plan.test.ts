import { describe, expect, test } from "bun:test";
import {
  validateWorkflowDecision,
  validateWorkflowPlan,
  type WorkflowPlan,
  workflowPlanIdentity,
} from "../src/index.js";

function plan(): WorkflowPlan {
  return {
    schema: "workflow-plan/v1",
    id: "plan-1",
    revision: 1,
    sources: [
      {
        id: "user-1",
        kind: "user",
        locator: "request:1",
        version: "1",
        content: "Build it",
        status: "available",
      },
    ],
    task: {
      schema: "lorelum.judge.task-contract/v1",
      id: "task-1",
      taskClass: "code",
      text: "Build it",
      acceptance: [{ id: "a1", text: "Works", source: { origin: "user", ref: "user-1" } }],
    },
    goal: "Build it",
    scope: ["implementation"],
    steps: [{ id: "s1", description: "Implement", acceptanceIds: ["a1"] }],
    checks: [{ id: "c1", description: "Check", acceptanceIds: ["a1"] }],
    nonGoals: [],
    missing: [],
    conflicts: [],
  };
}

function identity(value: unknown): string {
  const result = workflowPlanIdentity(value);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.identity;
}

describe("workflow plan", () => {
  test("validates a traceable plan and retains unresolved conflicts and missing material", () => {
    const value = plan();
    value.sources.push({
      id: "ref",
      kind: "reference",
      locator: "doc:1",
      version: "2",
      content: "",
      status: "unavailable",
    });
    value.missing.push("doc:1");
    value.conflicts.push({
      description: "Review differing requirements",
      sourceIds: ["user-1", "ref"],
    });
    expect(validateWorkflowPlan(value)).toEqual({ ok: true, value });
  });

  test("rejects missing, truncated, or unavailable acceptance sources", () => {
    for (const status of ["unavailable", "truncated"] as const) {
      const value = plan();
      value.sources[0]!.status = status;
      expect(validateWorkflowPlan(value).ok).toBe(false);
    }
    const value = plan();
    value.task.acceptance[0].source.ref = "unknown";
    expect(validateWorkflowPlan(value).ok).toBe(false);
  });

  test("rejects duplicates, dangling references, and missing step or check coverage", () => {
    const duplicateSource = plan();
    duplicateSource.sources.push({ ...duplicateSource.sources[0]! });
    expect(validateWorkflowPlan(duplicateSource).ok).toBe(false);
    const duplicateAcceptance = plan();
    duplicateAcceptance.task.acceptance.push({ ...duplicateAcceptance.task.acceptance[0] });
    expect(validateWorkflowPlan(duplicateAcceptance).ok).toBe(false);
    for (const kind of ["steps", "checks"] as const) {
      const duplicate = plan();
      duplicate[kind].push({ ...duplicate[kind][0]! });
      expect(validateWorkflowPlan(duplicate).ok).toBe(false);
      const dangling = plan();
      dangling[kind][0]!.acceptanceIds.push("unknown");
      expect(validateWorkflowPlan(dangling).ok).toBe(false);
      const missing = plan();
      missing[kind] = [];
      expect(validateWorkflowPlan(missing).ok).toBe(false);
    }
    const conflict = plan();
    conflict.conflicts.push({ description: "conflict", sourceIds: ["absent"] });
    expect(validateWorkflowPlan(conflict).ok).toBe(false);
  });

  test("enforces schema, source version and content, task validation, and safe revisions", () => {
    const emptyVersion = plan();
    emptyVersion.sources[0]!.version = "";
    expect(validateWorkflowPlan(emptyVersion).ok).toBe(false);
    const emptyContent = plan();
    emptyContent.sources[0]!.content = "";
    expect(validateWorkflowPlan(emptyContent).ok).toBe(false);
    const wildcard = plan();
    wildcard.task.taskClass = "*";
    expect(validateWorkflowPlan(wildcard).ok).toBe(false);
    for (const revision of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const bad = plan();
      bad.revision = revision;
      expect(validateWorkflowPlan(bad).ok).toBe(false);
    }
    expect(validateWorkflowPlan({ ...plan(), extra: true }).ok).toBe(false);
    expect(validateWorkflowPlan(null).ok).toBe(false);
    expect(
      validateWorkflowPlan({
        get schema() {
          throw new Error("unreadable");
        },
      }).ok,
    ).toBe(false);
  });

  test("identity covers revision, source version, content, task, and the entire ordered plan", () => {
    const base = identity(plan());
    const variants = [plan(), plan(), plan(), plan(), plan()];
    variants[0]!.revision++;
    variants[1]!.sources[0]!.version = "2";
    variants[2]!.sources[0]!.content = "Changed";
    variants[3]!.task.acceptance[0].text = "Changed";
    variants[4]!.steps[0]!.description = "Changed";
    for (const value of variants) expect(identity(value)).not.toBe(base);
    const ordered = plan();
    ordered.scope = ["first", "second"];
    const reversed = plan();
    reversed.scope = ["second", "first"];
    expect(identity(ordered)).not.toBe(identity(reversed));
    expect(identity(plan())).toBe(base);
    expect(workflowPlanIdentity({}).ok).toBe(false);
  });

  test("decision validation requires a host audit reference and exact plan identity shape", () => {
    const decision = {
      schema: "workflow-decision/v1",
      planId: "plan-1",
      revision: 1,
      planIdentity: identity(plan()),
      action: "confirm",
      hostDecisionRef: "audit:1",
    };
    expect(validateWorkflowDecision(decision).ok).toBe(true);
    expect(validateWorkflowDecision({ ...decision, hostDecisionRef: "" }).ok).toBe(false);
    expect(validateWorkflowDecision({ ...decision, planIdentity: "untrusted" }).ok).toBe(false);
    expect(validateWorkflowDecision({ ...decision, action: "approve-everything" }).ok).toBe(false);
  });
});
