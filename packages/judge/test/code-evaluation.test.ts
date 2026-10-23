import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCodeEvaluationReport, validateReviewExecutionV2 } from "@lorelum/judge-protocol";
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

test("an initially empty external context cannot disclose files without permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "judge-late-disclosure-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "user.name=Offline fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      { cwd: root, stdio: "pipe" },
    );
  let leaked = false;
  let calls = 0;
  const model: ModelPort = {
    async generate(request) {
      calls++;
      leaked ||= request.messages.some((message) =>
        message.content.includes("sensitive-context-marker"),
      );
      const preparing = request.messages[0]?.content.includes("You prepare");
      return {
        kind: "message",
        content: JSON.stringify(
          preparing
            ? {
                ...preparation,
                reads:
                  calls === 1
                    ? [{ session: 1, request: { kind: "read", path: "private.ts", side: "new" } }]
                    : [],
              }
            : evaluatedResponse(request),
        ),
      };
    },
  };
  try {
    git("init", "--quiet", "--template=");
    await writeFile(join(root, "private.ts"), 'export const fixture = "sensitive-context-marker";');
    git("add", "private.ts");
    git("commit", "--quiet", "-m", "fixture");
    const result = await evaluateCode(
      {
        target: { kind: "snippet", text: "export const publicValue = 1;" },
        context: [{ kind: "git", path: root, selection: "staged" }],
      },
      { model, method, sources: { roots: [root] }, limits: { maxContextRounds: 1 } },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(leaked).toBe(false);
    expect(calls).toBe(0);
    expect(result.value.status).toBe("failed");
    expect(result.value.issues.some((issue) => issue.code === "disclosure_not_authorized")).toBe(
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test("valid decisive verdicts cannot hide truncated final target coverage", async () => {
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
        kind: "files",
        files: [
          { path: "a.ts", text: "a".repeat(80) },
          { path: "b.ts", text: "b".repeat(40) },
        ],
      },
    },
    { model, method, limits: { maxContextRounds: 0, evidenceBudget: 100 } },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.execution?.attempts[0]?.status).toBe("completed");
  expect(
    result.value.execution?.attempts[0]?.evidenceBundle?.items.some(
      (item) => item.render?.state !== "rendered",
    ),
  ).toBe(true);
  expect(result.value.status).toBe("partial");
});

test("unresolved opinion and previous-problem references keep the overall request partial", async () => {
  const model: ModelPort = {
    async generate(request) {
      if (request.messages[0]?.content.includes("You prepare"))
        return { kind: "message", content: JSON.stringify(preparation) };
      const user = request.messages.find((message) => message.role === "user")?.content ?? "";
      const marker = "Untrusted review context:\n";
      const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)) as {
        followUpReferences: string[];
      };
      return {
        kind: "message",
        content: JSON.stringify({
          ...evaluatedResponse(request),
          followUps: context.followUpReferences.map((reference, index) => ({
            id: `follow-up-${index}`,
            reference,
            outcome: "unresolved",
            rationale: "必要的调用条件仍不可用。",
            evidenceIds: [],
          })),
        }),
      };
    },
  };
  const previous = await evaluateCode(
    {
      target: { kind: "snippet", text: "function list(items) { return items; }" },
      requirements: ["最多返回 20 条"],
    },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  if (!previous.ok) throw new Error(JSON.stringify(previous.issues));
  const result = await evaluateCode(
    {
      target: { kind: "snippet", text: "function list(items) { return items.slice(0, 20); }" },
      opinions: [{ id: "caller-boundary", text: "调用方是否也限制了条数？" }],
      previousReport: previous.value,
    },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.execution?.attempts[0]?.status).toBe("completed");
  expect(result.value.result?.followUps.map((observation) => observation.outcome)).toEqual([
    "unresolved",
    "unresolved",
  ]);
  expect(result.value.status).toBe("partial");
});

test("criterion order does not reject complete or partial results, but changed rationale still does", async () => {
  for (const invalidLocation of [false, true]) {
    const model: ModelPort = {
      async generate(request) {
        if (request.messages[0]?.content.includes("You prepare"))
          return { kind: "message", content: JSON.stringify(preparation) };
        const response = evaluatedResponse(request, invalidLocation);
        response.verdicts.reverse();
        return { kind: "message", content: JSON.stringify(response) };
      },
    };
    const result = await evaluateCode(
      {
        target: { kind: "snippet", text: "function list(items) { return items; }" },
        requirements: ["最多返回 20 条"],
      },
      { model, method, limits: { maxContextRounds: 0 } },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.status).toBe(invalidLocation ? "partial" : "completed");
    expect(
      Object.fromEntries(
        result.value.result?.verdicts.map((verdict) => [verdict.criterionId, verdict.verdict]) ??
          [],
      ),
    ).toEqual({ behavior: "weak", "explicit-1": "unmet" });
    if (!result.value.execution || !result.value.plan)
      throw new Error("missing completed preparation or execution");
    const corrupted = structuredClone(result.value.execution);
    const verdict = corrupted.attempts[0]?.result?.verdicts[0];
    if (!verdict) throw new Error("missing result verdict");
    verdict.rationale = "Changed independently of the measurement.";
    expect(validateReviewExecutionV2(corrupted, result.value.plan, result.value.source).ok).toBe(
      false,
    );
  }
});

test("terminal LF, CRLF and CR in requirements and opinions do not invalidate their source ranges", async () => {
  const model: ModelPort = {
    async generate(request) {
      if (request.messages[0]?.content.includes("You prepare"))
        return { kind: "message", content: JSON.stringify(preparation) };
      const response = evaluatedResponse(request);
      return {
        kind: "message",
        content: JSON.stringify({
          ...response,
          followUps: [
            {
              id: "opinion-check",
              reference: "opinion:limit",
              outcome: "supported",
              rationale: "可见实现直接返回全部元素。",
              evidenceIds: response.verdicts[0]?.evidenceIds ?? [],
            },
          ],
        }),
      };
    },
  };
  for (const ending of ["\n", "\r\n", "\r"]) {
    const result = await evaluateCode(
      {
        target: { kind: "snippet", text: "function list(items) { return items; }" },
        requirements: [`最多返回 20 条${ending}`],
        opinions: [{ id: "limit", text: `实现未限制返回条数${ending}` }],
      },
      { model, method, limits: { maxContextRounds: 0 } },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.status).toBe("completed");
    expect(result.value.execution?.attempts[0]?.status).toBe("completed");
    expect(result.value.plan?.requirements[0]?.text).toBe(`最多返回 20 条${ending}`);
    expect(
      result.value.source.items
        .filter((item) => item.role === "requirement" || item.role === "opinion")
        .map((item) => item.endLine),
    ).toEqual([1, 1]);
  }
});

test("record validation cannot promote unknown or insufficient judgments to a completed report", async () => {
  for (const judgment of ["unknown", "insufficient"]) {
    const model: ModelPort = {
      async generate(request) {
        if (request.messages[0]?.content.includes("You prepare"))
          return { kind: "message", content: JSON.stringify(preparation) };
        const response = evaluatedResponse(request);
        return {
          kind: "message",
          content: JSON.stringify({
            ...response,
            verdicts: response.verdicts.map((verdict) => ({
              ...verdict,
              verdict: judgment,
              evidenceIds: [],
              rationale: "必要的调用条件尚不可获得。",
            })),
          }),
        };
      },
    };
    const result = await evaluateCode(
      { target: { kind: "snippet", text: "export const value = 1;" } },
      { model, method, limits: { maxContextRounds: 0 } },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.execution?.attempts[0]?.status).toBe("completed");
    expect(result.value.status).toBe("partial");
    const changed = structuredClone(result.value);
    changed.limitations = [];
    expect(validateCodeEvaluationReport(changed).ok).toBe(true);
    changed.status = "completed";
    expect(validateCodeEvaluationReport(changed).ok).toBe(false);
  }
});

test("explanatory text does not change completion of otherwise completed facts", async () => {
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
    { target: { kind: "snippet", text: "export const value = 1;" } },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.status).toBe("completed");
  const annotated = structuredClone(result.value);
  annotated.limitations = ["宿主补充说明，不是未完成或停止事实。"];
  expect(validateCodeEvaluationReport(annotated).ok).toBe(true);
});

test("one missing criterion produces one assessment diagnostic", async () => {
  const model: ModelPort = {
    async generate(request) {
      if (request.messages[0]?.content.includes("You prepare"))
        return {
          kind: "message",
          content: JSON.stringify({
            ...preparation,
            standards: ["behavior", "boundaries"],
            excluded: preparation.excluded.filter((entry) => entry.id !== "boundaries"),
          }),
        };
      const response = evaluatedResponse(request);
      return {
        kind: "message",
        content: JSON.stringify({
          ...response,
          verdicts: response.verdicts.filter((verdict) => verdict.criterionId !== "boundaries"),
        }),
      };
    },
  };
  const result = await evaluateCode(
    { target: { kind: "snippet", text: "export const value = 1;" } },
    { model, method, limits: { maxContextRounds: 0 } },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.status).toBe("partial");
  expect(
    result.value.execution?.attempts[0]?.issues?.filter(
      (issue) => issue.code === "missing_verdict",
    ),
  ).toHaveLength(1);
  expect(result.value.result?.verdicts.map((verdict) => verdict.criterionId)).toEqual(["behavior"]);
});
