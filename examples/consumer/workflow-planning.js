import { PlanningSession } from "@lorelum/judge-workflow";
import { assert } from "./shared.js";

/** Offline consumer: propose, request adjustment, then explicitly confirm the revision. */
export async function runWorkflowPlanning() {
  const task = {
    schema: "lorelum.judge.task-contract/v1",
    id: "task-1",
    taskClass: "cli",
    text: "输出 JSON",
  };
  const sources = [
    {
      id: "request",
      kind: "user",
      locator: "request:1",
      version: "1",
      content: "输出 JSON",
      status: "available",
    },
  ];
  const session = new PlanningSession("plan-1", { task, sources });
  const model = {
    async generate(request) {
      const input = JSON.parse(request.messages[1].content);
      return {
        kind: "structured",
        value: {
          schema: "workflow-plan/v1",
          id: input.id,
          revision: input.revision,
          sources: input.sources,
          task: {
            ...input.task,
            acceptance: [
              { id: "json", text: "输出有效 JSON", source: { origin: "user", ref: "request" } },
            ],
          },
          goal: "输出 JSON",
          scope: ["CLI 输出"],
          steps: [
            {
              id: "implement",
              description: input.instructions || "实现 JSON 输出",
              acceptanceIds: ["json"],
            },
          ],
          checks: [{ id: "verify", description: "解析输出并核对内容", acceptanceIds: ["json"] }],
          nonGoals: ["发布"],
          missing: [],
          conflicts: [],
        },
      };
    },
  };
  const signal = new AbortController().signal;
  const first = await session.generate({ model, runId: "initial", signal });
  assert(first.ok && !first.value.eligible, "initial plan must await confirmation");
  const revision = await session.generate({
    model,
    runId: "revision",
    signal,
    instructions: "使用格式化 JSON",
  });
  assert(revision.ok, "revised plan must be generated");
  assert(
    !session.isEligible(first.value.identity, first.value.revision),
    "old plan must not be eligible",
  );
  const confirmed = session.confirm(revision.value.identity, revision.value.revision);
  assert(
    confirmed.ok && session.isEligible(revision.value.identity, revision.value.revision),
    "revised plan must be explicitly confirmed",
  );
  assert(
    session.review().operationAuthorized === false,
    "plan confirmation must not authorize operations",
  );
  return {
    revision: revision.value.revision,
    acceptanceProposed: revision.value.acceptanceProposed,
    operationAuthorized: false,
  };
}
