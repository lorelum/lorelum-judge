import { describe, expect, test } from "bun:test";
import type { TaskContract, WorkflowPlan, WorkflowSource } from "@lorelum/judge-protocol";
import type { JsonValue, ModelPort, ModelRequest, ModelResponse } from "@lorelum/judge-runtime";
import { type PlanningInputs, PlanningSession } from "../src/index.js";

const task: TaskContract = {
  schema: "lorelum.judge.task-contract/v1",
  id: "task-1",
  taskClass: "cli",
  text: "Add JSON output",
  acceptance: [{ id: "a1", text: "Print JSON", source: { origin: "user" as const, ref: "s1" } }],
};
const sources: WorkflowSource[] = [
  {
    id: "s1",
    kind: "user",
    locator: "request:1",
    version: "1",
    content: "Print JSON",
    status: "available",
  },
];
const inputs: PlanningInputs = { task, sources };
const signal = new AbortController().signal;

type Prompt = {
  id: string;
  revision: number;
  task: typeof task;
  sources: WorkflowSource[];
  instructions: string;
};
function proposal(prompt: Prompt): WorkflowPlan {
  return {
    schema: "workflow-plan/v1",
    id: prompt.id,
    revision: prompt.revision,
    task: prompt.task,
    sources: prompt.sources,
    goal: "Add JSON output",
    scope: ["CLI output"],
    steps: [
      {
        id: "step1",
        description: prompt.instructions || "Implement output",
        acceptanceIds: ["a1"],
      },
    ],
    checks: [{ id: "check1", description: "Check output", acceptanceIds: ["a1"] }],
    nonGoals: ["Deployment"],
    missing: [],
    conflicts: [],
  };
}
function modelFor(
  change: (plan: WorkflowPlan, request: ModelRequest) => unknown = (plan) => plan,
): ModelPort {
  return {
    async generate(request) {
      const prompt = JSON.parse(request.messages[1]!.content) as Prompt;
      return { kind: "structured", value: change(proposal(prompt), request) as JsonValue };
    },
  };
}
function generate(session: PlanningSession, model = modelFor(), instructions?: string) {
  return session.generate({
    model,
    runId: "run",
    disclosureIdentity: session.grantModelDisclosure(model),
    signal,
    ...(instructions === undefined ? {} : { instructions }),
  });
}

describe("planning session", () => {
  test("generates a reviewable proposal without tools or implicit approval", async () => {
    const session = new PlanningSession("plan1", inputs);
    const result = await generate(
      session,
      modelFor((plan, request) => {
        expect(request.tools).toEqual([]);
        expect(request.messages[0]?.role).toBe("system");
        return plan;
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("draft");
    expect(result.value.plan.task.acceptance[0]?.source.ref).toBe("s1");
    expect(result.value.eligible).toBe(false);
    expect(result.value.operationAuthorized).toBe(false);
    expect(session.isEligible(result.value.identity, result.value.revision)).toBe(false);
    expect(session.confirm(result.value.identity, result.value.revision).ok).toBe(true);
    expect(session.isEligible(result.value.identity, result.value.revision)).toBe(true);
    expect(session.review()?.operationAuthorized).toBe(false);
  });

  test("adjustment invalidates old confirmation and requires matching identity and revision", async () => {
    const session = new PlanningSession("plan1", inputs);
    const first = await generate(session);
    if (!first.ok) throw new Error("expected proposal");
    session.confirm(first.value.identity, first.value.revision);
    const second = await generate(session, modelFor(), "Use streaming output");
    if (!second.ok) throw new Error("expected revised proposal");
    expect(second.value.revision).toBe(first.value.revision + 1);
    expect(second.value.identity).not.toBe(first.value.identity);
    expect(session.isEligible(first.value.identity, first.value.revision)).toBe(false);
    expect(session.confirm(first.value.identity, second.value.revision).ok).toBe(false);
    expect(session.confirm(second.value.identity, first.value.revision).ok).toBe(false);
    expect(session.confirm(second.value.identity, second.value.revision).ok).toBe(true);
  });

  test("updates to sources preserve the reviewed plan but invalidate confirmation", async () => {
    const session = new PlanningSession("plan1", inputs);
    const first = await generate(session);
    if (!first.ok) throw new Error("expected proposal");
    session.confirm(first.value.identity, first.value.revision);
    expect(session.updateInputs(inputs).ok).toBe(true);
    expect(session.isEligible(first.value.identity, first.value.revision)).toBe(true);
    const updated = {
      task,
      sources: [
        ...sources,
        {
          id: "s2",
          kind: "reference" as const,
          locator: "doc:2",
          version: "1",
          content: "Conflicting information",
          status: "available" as const,
        },
      ],
    };
    expect(session.updateInputs(updated).ok).toBe(true);
    expect(session.review()?.status).toBe("invalidated");
    expect(session.review()?.plan).toEqual(first.value.plan);
    expect(session.confirm(first.value.identity, first.value.revision).ok).toBe(false);
    const revised = await generate(
      session,
      modelFor((plan) => ({
        ...plan,
        conflicts: [{ description: "Different requirements", sourceIds: ["s1", "s2"] }],
      })),
    );
    if (!revised.ok) throw new Error("expected conflicting proposal");
    expect(revised.value.plan.conflicts).toHaveLength(1);
    expect(session.confirm(revised.value.identity, revised.value.revision).ok).toBe(false);
  });

  test("revocation and premise invalidation block eligibility", async () => {
    const session = new PlanningSession("plan1", inputs);
    const first = await generate(session);
    if (!first.ok) throw new Error("expected proposal");
    session.confirm(first.value.identity, first.value.revision);
    expect(session.revoke().ok).toBe(true);
    expect(session.isEligible(first.value.identity, first.value.revision)).toBe(false);
    expect(session.confirm(first.value.identity, first.value.revision).ok).toBe(false);
    const second = await generate(session);
    if (!second.ok) throw new Error("expected proposal");
    session.confirm(second.value.identity, second.value.revision);
    expect(session.invalidate().ok).toBe(true);
    expect(session.review()?.status).toBe("invalidated");
    expect(session.isEligible(second.value.identity, second.value.revision)).toBe(false);
  });

  test("models propose traceable criteria from host task metadata and revise them only as drafts", async () => {
    const { schema, id, taskClass, text } = task;
    const session = new PlanningSession("plan1", {
      task: { schema, id, taskClass, text },
      sources,
    });
    const candidateModel = modelFor((plan) => ({ ...plan, task }));
    const first = await generate(session, candidateModel);
    if (!first.ok) throw new Error("expected candidate proposal");
    expect(first.value.acceptanceProposed).toBe(true);
    expect(first.value.plan.task.acceptance[0]?.source.ref).toBe("s1");
    expect(session.confirm(first.value.identity, first.value.revision).ok).toBe(true);
    const revised = await generate(
      session,
      modelFor((plan) => ({
        ...plan,
        task: { ...task, acceptance: [{ ...task.acceptance[0], text: "Print formatted JSON" }] },
      })),
      "Require formatted output",
    );
    if (!revised.ok) throw new Error("expected revised candidate");
    expect(revised.value.acceptanceProposed).toBe(true);
    expect(revised.value.plan.task.acceptance[0]?.text).toBe("Print formatted JSON");
    expect(session.isEligible(first.value.identity, first.value.revision)).toBe(false);
    expect(session.confirm(revised.value.identity, revised.value.revision).ok).toBe(true);
  });

  test("candidate criteria cannot invent sources or mislabel reference material as user instruction", async () => {
    const { schema, id, taskClass, text } = task;
    const reference: WorkflowSource = { ...sources[0]!, kind: "reference" };
    const session = new PlanningSession("plan1", {
      task: { schema, id, taskClass, text },
      sources: [reference],
    });
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({ ...plan, task })),
        )
      ).ok,
    ).toBe(false);
    const missingSource = {
      ...task,
      acceptance: [{ ...task.acceptance[0], source: { origin: "contract", ref: "invented" } }],
    };
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({ ...plan, task: missingSource })),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({
            ...plan,
            task: {
              ...task,
              acceptance: [{ ...task.acceptance[0], source: { origin: "contract", ref: "s1" } }],
            },
            sources: [...plan.sources, sources[0]],
          })),
        )
      ).ok,
    ).toBe(false);
  });

  test("model errors, malformed responses, tool calls and invalid references fail honestly", async () => {
    const session = new PlanningSession("plan1", inputs);
    const first = await generate(session);
    if (!first.ok) throw new Error("expected proposal");
    session.confirm(first.value.identity, first.value.revision);
    const error = new Error("provider failure");
    expect(
      await generate(session, {
        async generate() {
          throw error;
        },
      }),
    ).toEqual({ ok: false, error: { kind: "model", error } });
    expect(session.isEligible(first.value.identity, first.value.revision)).toBe(false);
    expect(
      (
        await generate(session, {
          async generate() {
            return { kind: "message", content: "not JSON" };
          },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await generate(session, {
          async generate() {
            return { kind: "tool_calls", calls: [] };
          },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({ ...plan, checks: [] })),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({ ...plan, task: { ...plan.task, text: "changed" } })),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({ ...plan, sources: [{ ...plan.sources[0], content: "invented" }] })),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await generate(
          session,
          modelFor((plan) => ({ ...plan, approved: true })),
        )
      ).ok,
    ).toBe(false);
  });

  test("accepts valid JSON message proposals", async () => {
    const session = new PlanningSession("plan1", inputs);
    const model: ModelPort = {
      async generate(request) {
        const prompt = JSON.parse(request.messages[1]!.content) as Prompt;
        return { kind: "message", content: JSON.stringify(proposal(prompt)) };
      },
    };
    const result = await generate(session, model);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptanceProposed).toBe(false);
  });

  test("review snapshots and caller-owned inputs cannot mutate the session", async () => {
    const mutable = structuredClone(inputs);
    const session = new PlanningSession("plan1", mutable);
    Object.assign(mutable.sources[0]!, { content: "tampered" });
    const result = await generate(session);
    if (!result.ok) throw new Error("expected proposal");
    expect(result.value.plan.sources[0]?.content).toBe("Print JSON");
    Object.assign(result.value.plan.sources[0]!, { content: "tampered" });
    expect(session.review()?.plan.sources[0]?.content).toBe("Print JSON");
    expect(session.confirm(result.value.identity, result.value.revision).ok).toBe(true);
  });

  test("a late model response cannot overwrite changed premises", async () => {
    const session = new PlanningSession("plan1", inputs);
    const deferred = Promise.withResolvers<ModelResponse>();
    let proposed: JsonValue = null;
    const model: ModelPort = {
      generate(request) {
        const prompt = JSON.parse(request.messages[1]!.content) as Prompt;
        proposed = proposal(prompt) as unknown as JsonValue;
        return deferred.promise;
      },
    };
    const pending = generate(session, model);
    session.updateInputs({ task, sources: [{ ...sources[0]!, version: "2" }] });
    deferred.resolve({ kind: "structured", value: proposed });
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(session.review()).toBeNull();
  });

  test("a reentrant model response cannot approve stale premises", async () => {
    const session = new PlanningSession("plan1", inputs);
    const model = modelFor((plan) => {
      Object.defineProperty(plan, "goal", {
        enumerable: true,
        get() {
          session.updateInputs({ task, sources: [{ ...sources[0]!, version: "2" }] });
          return "Add JSON output";
        },
      });
      return plan;
    });
    const result = await generate(session, model);
    expect(result.ok).toBe(false);
    expect(session.review()).toBeNull();
  });

  test("cancellation while reading a model response cannot publish a plan", async () => {
    const session = new PlanningSession("plan1", inputs);
    const controller = new AbortController();
    const model = modelFor((plan) => {
      Object.defineProperty(plan, "goal", {
        enumerable: true,
        get() {
          controller.abort();
          return "Add JSON output";
        },
      });
      return plan;
    });
    const result = await session.generate({
      model,
      runId: "run",
      signal: controller.signal,
      disclosureIdentity: session.grantModelDisclosure(model),
    });
    expect(result.ok).toBe(false);
    expect(session.review()).toBeNull();
  });
  test("invalidation notifies synchronously, isolates failures, and supports unsubscribe", async () => {
    const session = new PlanningSession("plan1", inputs);
    const first = await generate(session);
    if (!first.ok) throw new Error("expected proposal");
    session.confirm(first.value.identity, first.value.revision);
    const seen: boolean[] = [];
    session.subscribeInvalidation(() => {
      throw new Error("listener failure");
    });
    const unsubscribe = session.subscribeInvalidation(() => {
      seen.push(session.isEligible(first.value.identity, first.value.revision));
    });
    expect(session.revoke().ok).toBe(true);
    expect(seen).toEqual([false]);
    unsubscribe();
    expect(session.invalidate().ok).toBe(true);
    expect(seen).toEqual([false]);
  });

  test("reentrant invalidation cannot start a stale model request", async () => {
    const session = new PlanningSession("plan1", inputs);
    const delegate = modelFor();
    let calls = 0;
    const model: ModelPort = {
      async generate(request) {
        calls++;
        return delegate.generate(request);
      },
    };
    const first = await generate(session, model);
    if (!first.ok) throw new Error("expected proposal");
    session.confirm(first.value.identity, first.value.revision);
    calls = 0;
    const unsubscribe = session.subscribeInvalidation(() => {
      unsubscribe();
      session.updateInputs({ task, sources: [{ ...sources[0]!, version: "changed" }] });
    });
    const result = await generate(session, model);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
    expect(session.isEligible(first.value.identity, first.value.revision)).toBe(false);
  });
  test("planning disclosure is explicitly granted to the current model and premises", async () => {
    const session = new PlanningSession("plan1", inputs);
    const model = modelFor();
    let calls = 0;
    const other: ModelPort = {
      async generate() {
        calls++;
        throw new Error("must not run");
      },
    };
    const disclosureIdentity = session.grantModelDisclosure(model);
    const denied = await session.generate({
      model: other,
      runId: "run",
      signal,
      disclosureIdentity,
    });
    expect(denied.ok).toBe(false);
    expect(calls).toBe(0);
    session.updateInputs({ task, sources: [{ ...sources[0]!, version: "changed" }] });
    const stale = await session.generate({ model, runId: "run", signal, disclosureIdentity });
    expect(stale.ok).toBe(false);
    const current = session.grantModelDisclosure(model);
    session.revokeModelDisclosure();
    const revoked = await session.generate({
      model,
      runId: "run",
      signal,
      disclosureIdentity: current,
    });
    expect(revoked.ok).toBe(false);
  });
});
