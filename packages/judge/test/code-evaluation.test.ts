import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelPort, ModelRequest } from "@lorelum/judge-runtime";
import { type EvaluationPorts, evaluateCode } from "../src/index.js";

const method: EvaluationPorts["method"] = {
  kind: "llm",
  provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
  endpointIdentity: `sha256:${"a".repeat(64)}`,
  model: { provider: "offline", name: "code-evaluation-test" },
};

const preparation = {
  task: "inspect",
  focus: [],
  standards: ["behavior"],
  requirements: [],
  excluded: ["boundaries", "security", "concurrency", "performance", "maintenance"].map((id) => ({
    id,
    reason: "This test examines one explicit behavioral contract only.",
  })),
  reads: [],
};

function evaluatedResponse(request: ModelRequest, invalidLocation = false) {
  const user = request.messages.find((message) => message.role === "user")?.content ?? "";
  const marker = "Untrusted review context:\n";
  const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)) as {
    sources: { id: string; role: string; startLine: number }[];
  };
  const item = context.sources.find((source) => source.role === "target");
  if (item === undefined) throw new Error("test requires actual target evidence");
  const criteria = [...user.matchAll(/^Criterion ([^ ]+) \((quality|contract),/gm)].map(
    (match) => ({ id: match[1] ?? "", kind: match[2] }),
  );
  const contract = criteria.find((criterion) => criterion.kind === "contract");
  const criterionId = contract?.id ?? criteria[0]?.id ?? "behavior";
  const hasProblem = invalidLocation || contract !== undefined;
  return {
    schema: "lorelum.judge.review-result/v2",
    verdicts: criteria.map((criterion) => ({
      schema: "lorelum.judge.verdict/v1",
      criterionId: criterion.id,
      verdict: criterion.kind === "contract" ? "unmet" : hasProblem ? "weak" : "strong",
      evidenceIds: [item.id],
      rationale: contract
        ? "The visible implementation returns all items rather than the explicit limit."
        : "Assessment is limited to the provided function.",
    })),
    summary: [
      {
        text: hasProblem ? "可见实现与明确的条数约定不一致。" : "本次仅检查提供的函数。",
        criterionIds: [criterionId],
        problemIds: hasProblem ? ["limit"] : [],
        evidenceIds: [item.id],
      },
    ],
    problems: hasProblem
      ? [
          {
            id: "limit",
            criterionId,
            title: "返回全部数据而非限定条数",
            severity: "medium",
            condition: "输入超过约定条数",
            impact: "调用方收到超出约定的结果",
            rationale: "实现直接返回原数组。",
            evidenceIds: [item.id],
            locations: [
              {
                itemId: item.id,
                startLine: invalidLocation ? 999 : item.startLine,
                endLine: invalidLocation ? 999 : item.startLine,
              },
            ],
            attribution: "not_applicable",
          },
        ]
      : [],
    pending: [],
    followUps: [],
  };
}

test("source disclosure is denied before a model call and leaves the target unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "judge-disclosure-"));
  const path = join(root, "subject.ts");
  const text = "export const value = 1;\n";
  await writeFile(path, text);
  let calls = 0;
  const model: ModelPort = {
    async generate() {
      calls += 1;
      throw new Error("must not send source");
    },
  };
  try {
    const result = await evaluateCode(
      { target: { kind: "local", path } },
      { model, method, sources: { roots: [root] } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.status).toBe("failed");
    expect(result.value.issues.some((issue) => issue.code === "disclosure_not_authorized")).toBe(
      true,
    );
    expect(calls).toBe(0);
    expect(await readFile(path, "utf8")).toBe(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a preparation model cannot invent a user requirement", async () => {
  let calls = 0;
  const model: ModelPort = {
    async generate() {
      calls += 1;
      return {
        kind: "message",
        content: JSON.stringify({
          ...preparation,
          requirements: [{ text: "Use a database", source: "user" }],
        }),
      };
    },
  };
  const result = await evaluateCode(
    { target: { kind: "snippet", text: "export const value = 1;" }, request: "检查可见行为" },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.status).toBe("failed");
  expect(result.value.issues.some((issue) => issue.code === "unsupported_requirement")).toBe(true);
  expect(result.value.execution).toBeUndefined();
  expect(calls).toBe(1);
});

test("explicit requirements remain enforceable when preparation omits them", async () => {
  const model: ModelPort = {
    async generate(request) {
      return {
        kind: "message",
        content: JSON.stringify(
          request.messages[0]?.content.includes("You prepare")
            ? preparation
            : evaluatedResponse(request),
        ),
      };
    },
  };
  const result = await evaluateCode(
    {
      target: { kind: "snippet", text: "function list(items) { return items; }" },
      requirements: ["最多返回 20 条"],
    },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const requirement = result.value.plan?.requirements.find(
    (entry) => entry.text === "最多返回 20 条",
  );
  expect(requirement).toBeDefined();
  expect(
    result.value.result?.verdicts.find((entry) => entry.criterionId === requirement?.id)?.verdict,
  ).toBe("unmet");
});

test("an invented final line cannot produce a complete or clean report", async () => {
  const model: ModelPort = {
    async generate(request) {
      return {
        kind: "message",
        content: JSON.stringify(
          request.messages[0]?.content.includes("You prepare")
            ? preparation
            : evaluatedResponse(request, true),
        ),
      };
    },
  };
  const result = await evaluateCode(
    { target: { kind: "snippet", text: "function list(items) { return items; }" } },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.status).toBe("partial");
  expect(result.value.execution?.attempts[0]?.status).toBe("partial");
  expect(result.value.execution?.attempts[0]?.run).toBeUndefined();
  expect(result.value.result?.problems).toEqual([]);
});

test("cancellation during preparation never starts formal evaluation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const model: ModelPort = {
    async generate() {
      calls += 1;
      controller.abort();
      return { kind: "message", content: JSON.stringify(preparation) };
    },
  };
  const result = await evaluateCode(
    { target: { kind: "snippet", text: "export const value = 1;" } },
    { model, method, signal: controller.signal },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.status).toBe("cancelled");
  expect(result.value.execution).toBeUndefined();
  expect(calls).toBe(1);
});

test("new-file attribution requires reader-established absence, not merely a new-side assertion", async () => {
  const model: ModelPort = {
    async generate(request) {
      if (request.messages[0]?.content.includes("You prepare"))
        return { kind: "message", content: JSON.stringify(preparation) };
      const response = evaluatedResponse(request);
      for (const problem of response.problems) problem.attribution = "introduced";
      return { kind: "message", content: JSON.stringify(response) };
    },
  };
  const added = await evaluateCode(
    {
      target: {
        kind: "comparison",
        old: [],
        new: [{ path: "new.ts", text: "function list(items) { return items; }" }],
      },
      requirements: ["最多返回 20 条"],
    },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  const unproven = await evaluateCode(
    {
      target: {
        kind: "files",
        files: [{ path: "new.ts", text: "function list(items) { return items; }" }],
      },
      requirements: ["最多返回 20 条"],
    },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  if (!added.ok) throw new Error(JSON.stringify(added.issues));
  if (!unproven.ok) throw new Error(JSON.stringify(unproven.issues));
  expect(added.value.status).toBe("completed");
  expect(added.value.result?.problems[0]?.attribution).toBe("introduced");
  expect(unproven.value.status).toBe("partial");
  expect(unproven.value.result?.problems).toEqual([]);
});

test("the requested projection budget also constrains final problem locations", async () => {
  const model: ModelPort = {
    async generate(request) {
      return {
        kind: "message",
        content: JSON.stringify(
          request.messages[0]?.content.includes("You prepare")
            ? preparation
            : evaluatedResponse(request),
        ),
      };
    },
  };
  const result = await evaluateCode(
    {
      target: {
        kind: "snippet",
        text: `function list(items) { /* ${"context ".repeat(30)} */ return items; }`,
      },
      requirements: ["最多返回 20 条"],
    },
    { model, method, limits: { maxContextRounds: 0, evidenceBudget: 80 } },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.status).toBe("partial");
  expect(result.value.execution?.attempts[0]?.status).toBe("partial");
  expect(result.value.execution?.attempts[0]?.run).toBeUndefined();
  expect(result.value.result?.problems).toEqual([]);
});
