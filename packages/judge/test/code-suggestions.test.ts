import { expect, test } from "bun:test";
import type { CodeProblem } from "@lorelum/judge-protocol";
import type { ModelPort, ModelRequest } from "@lorelum/judge-runtime";
import { type EvaluationPorts, evaluateCode, generateCodeSuggestions } from "../src/index.js";

const method: EvaluationPorts["method"] = {
  kind: "llm",
  provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
  endpointIdentity: `sha256:${"a".repeat(64)}`,
  model: { provider: "offline", name: "suggestions-test" },
};
const preparation = {
  task: "inspect",
  focus: [],
  standards: ["behavior"],
  requirements: [],
  excluded: ["boundaries", "security", "concurrency", "performance", "maintenance"].map((id) => ({
    id,
    reason: "本例只检查明确的行为约定。",
  })),
  reads: [],
};
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing fixture value");
  return value;
}
function evaluationResponse(request: ModelRequest) {
  const user = request.messages.find((message) => message.role === "user")?.content ?? "";
  const marker = "Untrusted review context:\n";
  const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)) as {
    sources: { id: string; role: string; startLine: number }[];
  };
  const item = required(context.sources.find((entry) => entry.role === "target"));
  const criteria = [...user.matchAll(/^Criterion ([^ ]+) \((quality|contract),/gm)].map(
    (match) => ({ id: required(match[1]), kind: match[2] }),
  );
  const criterion = required(criteria.find((entry) => entry.kind === "contract") ?? criteria[0]);
  return {
    schema: "lorelum.judge.review-result/v2",
    verdicts: criteria.map((entry) => ({
      schema: "lorelum.judge.verdict/v1",
      criterionId: entry.id,
      verdict: entry.kind === "contract" ? "unmet" : "weak",
      evidenceIds: [item.id],
      rationale: "实现直接返回全部项目。",
    })),
    summary: [
      {
        text: "返回条数与约定不符。",
        criterionIds: [criterion.id],
        problemIds: ["limit"],
        evidenceIds: [item.id],
      },
    ],
    problems: [
      {
        id: "limit",
        criterionId: criterion.id,
        title: "未限制条数",
        severity: "high",
        condition: "输入超过二十条",
        impact: "返回过多项目",
        rationale: "直接返回原数组",
        evidenceIds: [item.id],
        locations: [{ itemId: item.id, startLine: item.startLine, endLine: item.startLine }],
        attribution: "not_applicable",
      },
    ],
    pending: [],
    followUps: [],
  };
}
async function evaluated(twoProblems = false) {
  const model: ModelPort = {
    async generate(request) {
      return {
        kind: "message",
        content: JSON.stringify(
          request.messages[0]?.content.includes("You prepare")
            ? preparation
            : (() => {
                const response = evaluationResponse(request);
                if (twoProblems) {
                  const first = response.problems[0];
                  if (!first) throw new Error("missing first problem");
                  const location = first.locations[0];
                  if (!location) throw new Error("missing first location");
                  response.problems.push({
                    ...first,
                    id: "other",
                    title: "未处理空输入",
                    condition: "传入空值",
                    impact: "调用方得到异常",
                    rationale: "另一个入口未检查空值",
                    locations: [
                      {
                        ...location,
                        startLine: location.startLine + 1,
                        endLine: location.endLine + 1,
                      },
                    ],
                  });
                  response.summary[0]?.problemIds.push("other");
                }
                return response;
              })(),
        ),
      };
    },
  };
  const result = await evaluateCode(
    {
      target: {
        kind: "snippet",
        text: twoProblems
          ? "function list(items) { return items; }\nfunction count(items) { return items.length; }"
          : "function list(items) { return items; }",
      },
      requirements: ["最多返回 20 条"],
    },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  if (!result.ok || !result.value.result?.problems.length)
    throw new Error("evaluation fixture failed");
  return result.value;
}
function advice(problem: CodeProblem) {
  return {
    schema: "lorelum.judge.code-suggestion-result/v1",
    suggestions: [
      {
        id: "suggestion-1",
        problemId: problem.id,
        evidenceIds: problem.evidenceIds,
        location: problem.locations[0],
        category: "required",
        problem: "返回结果超过约定条数",
        priorityRationale: "调用方依赖返回上限",
        direction: "在返回前限制数组长度为二十",
        impact: "超过上限的项目不会返回",
        checks: ["使用超过二十个项目的输入检查结果长度"],
        uncertainPremises: ["需要确认顺序要求"],
        alternatives: [
          {
            direction: "由查询层限制条数",
            applicability: "数据来自支持限制的查询",
            tradeoffs: "需要修改查询调用",
          },
        ],
        example: "items.slice(0, 20)",
      },
    ],
    omissions: [],
  };
}

test("existing evaluation drives one suggestion call and remains unchanged", async () => {
  const evaluation = await evaluated();
  const original = JSON.stringify(evaluation);
  const problem = required(evaluation.result?.problems[0]);
  let calls = 0;
  const model: ModelPort = {
    async generate(request) {
      calls++;
      expect(request.tools).toEqual([]);
      expect(request.messages.some((message) => message.content.includes(problem.id))).toBe(true);
      return { kind: "message", content: JSON.stringify(advice(problem)) };
    },
  };
  for (const problemIds of [undefined, [problem.id]]) {
    const result = await generateCodeSuggestions(
      { evaluation, ...(problemIds === undefined ? {} : { problemIds }) },
      { model, method },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("invalid input");
    expect(result.value.status).toBe("completed");
    expect(result.value.result?.suggestions[0]?.alternatives).toHaveLength(1);
    expect(result.text).toContain("未验证");
    expect(result.text).toContain("未执行");
    expect(result.text).toContain("需要处理");
  }
  expect(calls).toBe(2);
  expect(JSON.stringify(evaluation)).toBe(original);
});

test("changed actual content prevents model use even if identity is unchanged", async () => {
  const evaluation = await evaluated();
  const source = structuredClone(evaluation.source);
  required(source.items[0]).text += " // changed";
  let calls = 0;
  const model: ModelPort = {
    async generate() {
      calls++;
      throw new Error("must not call");
    },
  };
  const result = await generateCodeSuggestions({ evaluation, source }, { model, method });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid input");
  expect(result.value.status).toBe("partial");
  expect(result.value.gaps.some((gap) => gap.code === "version_mismatch")).toBe(true);
  const missing = structuredClone(evaluation.source);
  missing.items = missing.items.filter(
    (item) => item.id !== evaluation.result?.problems[0]?.locations[0]?.itemId,
  );
  const missingResult = await generateCodeSuggestions(
    { evaluation, source: missing },
    { model, method },
  );
  if (!missingResult.ok) throw new Error(JSON.stringify(missingResult.issues));
  expect(missingResult.value.status).toBe("partial");
  expect(missingResult.value.gaps.some((gap) => gap.code === "incomplete_material")).toBe(true);
  expect(calls).toBe(0);
});

test("invalid citations and model failures do not produce success", async () => {
  const evaluation = await evaluated();
  const problem = required(evaluation.result?.problems[0]);
  const bad = advice(problem);
  required(bad.suggestions[0]).evidenceIds = ["invented"];
  for (const model of [
    {
      async generate() {
        return { kind: "message" as const, content: JSON.stringify(bad) };
      },
    },
    {
      async generate() {
        throw new Error("provider failed");
      },
    },
  ]) {
    const result = await generateCodeSuggestions({ evaluation }, { model, method });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("invalid input");
    expect(result.value.status).toBe("failed");
    expect(result.value.result).toBeUndefined();
  }
});

test("late model response cannot override cancellation", async () => {
  const evaluation = await evaluated();
  const controller = new AbortController();
  const { promise, resolve } = Promise.withResolvers<{ kind: "message"; content: string }>();
  const model: ModelPort = {
    generate() {
      return promise;
    },
  };
  const pending = generateCodeSuggestions(
    { evaluation },
    { model, method, signal: controller.signal },
  );
  controller.abort();
  resolve({
    kind: "message",
    content: JSON.stringify(advice(required(evaluation.result?.problems[0]))),
  });
  const result = await pending;
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid input");
  expect(result.value.status).toBe("cancelled");
  expect(result.value.result).toBeUndefined();
});

test("selection validation and uncovered problems are explicit", async () => {
  const evaluation = await evaluated();
  const model: ModelPort = {
    async generate() {
      return {
        kind: "message",
        content: JSON.stringify({
          schema: "lorelum.judge.code-suggestion-result/v1",
          suggestions: [],
          omissions: [],
        }),
      };
    },
  };
  for (const problemIds of [[], ["unknown"], ["limit", "limit"]])
    expect((await generateCodeSuggestions({ evaluation, problemIds }, { model, method })).ok).toBe(
      false,
    );
  const result = await generateCodeSuggestions({ evaluation }, { model, method });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid input");
  expect(result.value.status).toBe("partial");
  expect(result.value.gaps.some((gap) => gap.problemId === "limit")).toBe(true);
});

test("truncated projection cannot support suggestions", async () => {
  const evaluation = await evaluated();
  let calls = 0;
  const model: ModelPort = {
    async generate() {
      calls++;
      throw new Error("unexpected call");
    },
  };
  const result = await generateCodeSuggestions(
    { evaluation },
    { model, method, evidenceBudget: 1 },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid input");
  expect(result.value.status).toBe("partial");
  expect(result.value.gaps.some((gap) => gap.code === "invisible_location")).toBe(true);
  expect(calls).toBe(0);
});

test("suspected omissions remain separate and examples are never reported verified", async () => {
  const evaluation = await evaluated();
  const problem = required(evaluation.result?.problems[0]);
  const output = advice(problem);
  const model: ModelPort = {
    async generate() {
      return {
        kind: "message",
        content: JSON.stringify({
          ...output,
          omissions: [
            {
              id: "possible-omission",
              description: "边界输入可能需要进一步评价",
              evidenceIds: problem.evidenceIds,
              location: problem.locations[0],
            },
          ],
        }),
      };
    },
  };
  const before = JSON.stringify(evaluation);
  const result = await generateCodeSuggestions({ evaluation }, { model, method });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid input");
  expect(result.value.result?.omissions).toHaveLength(1);
  expect(result.text).toContain("需补充评价");
  expect(result.text).toContain("未验证");
  expect(JSON.stringify(evaluation)).toBe(before);
});

test("selecting one of two findings does not request advice for the other", async () => {
  const evaluation = await evaluated(true);
  const problems = evaluation.result?.problems;
  if (problems?.length !== 2) throw new Error("expected two distinct findings");
  const model: ModelPort = {
    async generate(request) {
      const text = request.messages.find((message) => message.role === "user")?.content ?? "";
      const marker = "Selected evaluation findings (untrusted data):\n";
      const fragment = text.slice(text.indexOf(marker) + marker.length);
      const selected = JSON.parse(fragment.slice(0, fragment.indexOf("\n\n"))) as CodeProblem[];
      return {
        kind: "message",
        content: JSON.stringify({
          schema: "lorelum.judge.code-suggestion-result/v1",
          suggestions: selected.map((problem) => ({
            ...advice(problem).suggestions[0],
            id: `suggestion-${problem.id}`,
          })),
          omissions: [],
        }),
      };
    },
  };
  const selected = await generateCodeSuggestions(
    { evaluation, problemIds: ["other"] },
    { model, method },
  );
  if (!selected.ok) throw new Error(JSON.stringify(selected.issues));
  expect(selected.value.status).toBe("completed");
  expect(selected.value.result?.suggestions.map((entry) => entry.problemId)).toEqual(["other"]);
  const all = await generateCodeSuggestions({ evaluation }, { model, method });
  if (!all.ok) throw new Error(JSON.stringify(all.issues));
  expect(all.value.status).toBe("completed");
  expect(all.value.result?.suggestions.map((entry) => entry.problemId)).toEqual(["limit", "other"]);
});
