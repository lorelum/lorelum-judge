import { describe, expect, test } from "bun:test";
import type { ModelPort, ModelRequest, ModelResponse } from "@lorelum/judge-runtime";
import type {
  EvidenceMaterial,
  ExecuteReviewInput,
  ProgramChecker,
  ProgramCheckerOutput,
  ReviewMethodInput,
} from "../src/index.js";
import { executeReview, REVIEW_SYSTEM_PROMPT } from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

function definition(roles: readonly ("decisive" | "advisory")[] = ["decisive", "decisive"]) {
  const ids = ["c1", "c2"];
  return {
    schema: "lorelum.judge.measurement-definition/v2",
    id: "review",
    criteria: ids.map((id, index) => ({
      schema: "lorelum.judge.criterion/v1",
      id,
      kind: "contract" as const,
      description: `criterion ${id}`,
      mandatory: true,
      source: { origin: "contract" as const, ref: `AC-${id}` },
      anchors: [
        { verdict: "met" as const, description: "satisfied" },
        { verdict: "unmet" as const, description: "not satisfied" },
      ],
      evidence: [{ evidenceId: `e${index + 1}`, role: "primary" as const }],
    })),
    metadata: ids.map((id, index) => ({
      criterionId: id,
      role: roles[index] ?? "decisive",
      covers: [],
      appliesTo: ["code"],
    })),
  };
}

const evidence: readonly EvidenceMaterial[] = [
  { id: "e1", status: "present", text: "the code does the thing" },
  { id: "e2", status: "present", text: "the code does another thing" },
];

const programMethod: ReviewMethodInput = {
  kind: "program",
  checker: { id: "offline-checker", version: "1" },
};

const llmMethod: ReviewMethodInput = {
  kind: "llm",
  provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
  endpointIdentity: hex("a"),
  model: { provider: "mock", name: "model-1" },
  decoding: { temperature: 0, seed: 7 },
};

function met(criterionId: string, evidenceId: string) {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId,
    verdict: "met",
    evidenceIds: [evidenceId],
  };
}

class ScriptedModel implements ModelPort {
  readonly requests: ModelRequest[] = [];
  private readonly responses: Array<ModelResponse | Error>;

  constructor(responses: readonly (ModelResponse | Error)[]) {
    this.responses = [...responses];
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("no response left");
    if (response instanceof Error) throw response;
    return response;
  }
}

function input(overrides: Partial<ExecuteReviewInput> = {}): ExecuteReviewInput {
  return {
    definition: definition(),
    evidence,
    method: programMethod,
    ...overrides,
  };
}

describe("executeReview with a program checker", () => {
  test("runs once by default and produces a complete v2 run", async () => {
    let calls = 0;
    const checker: ProgramChecker = () => {
      calls += 1;
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const result = await executeReview(input(), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(1);
    expect(result.value.execution.plannedCount).toBe(1);
    expect(result.value.execution.attempts).toHaveLength(1);
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("completed");
    expect(attempt?.run?.verdicts).toHaveLength(2);
    expect(result.value.completeness).toBe("complete");
    expect(result.value.instrument.method.kind).toBe("program");
  });

  test("snapshots input before execution", async () => {
    let seen = "";
    const checker: ProgramChecker = async ({ evidence: copied }) => {
      await Promise.resolve();
      seen = copied[0]?.text ?? "";
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const materials: EvidenceMaterial[] = [{ id: "e1", status: "present", text: "original" }];
    const pending = executeReview(input({ evidence: materials }), { checker });
    materials[0] = { id: "e2", status: "unavailable" };
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(seen).toBe("original");
  });

  test("keeps legal findings when one criterion is omitted", async () => {
    const checker: ProgramChecker = () => ({ verdicts: [met("c1", "e1")] });
    const result = await executeReview(input(), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("partial");
    expect(attempt?.run).toBeUndefined();
    expect(attempt?.verdicts).toHaveLength(1);
    expect(result.value.completeness).toBe("partial");
    const second = result.value.findings.find((finding) => finding.criterionId === "c2");
    expect(second?.status).toBe("invalid");
    expect(second?.issues.map((issue) => issue.code)).toContain("missing_verdict");
  });

  test("marks duplicate and unknown entries without choosing one", async () => {
    const checker: ProgramChecker = () => ({
      verdicts: [met("c1", "e1"), met("c1", "e1"), met("ghost", "e1"), met("c2", "e2")],
    });
    const result = await executeReview(input(), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("partial");
    expect(attempt?.verdicts?.map((verdict) => verdict.criterionId)).toEqual(["c2"]);
    const codes = attempt?.issues?.map((issue) => issue.code) ?? [];
    expect(codes).toContain("duplicate_verdict");
    expect(codes).toContain("unknown_criterion");
  });

  test("keeps unknown as a legal verdict", async () => {
    const checker: ProgramChecker = () => ({
      verdicts: [
        {
          schema: "lorelum.judge.verdict/v1",
          criterionId: "c1",
          verdict: "unknown",
          evidenceIds: [],
        },
        met("c2", "e2"),
      ],
    });
    const result = await executeReview(input(), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.execution.attempts[0]?.status).toBe("completed");
    expect(result.value.execution.attempts[0]?.run?.verdicts[0]?.verdict).toBe("unknown");
  });

  test("empty or unrepresentable checker messages fall back safely", async () => {
    const cases: Array<[string, string]> = [
      ["", "the checker failed"],
      ["   ", "the checker failed"],
      ["broken \uD800", "broken \uFFFD"],
    ];
    for (const [message, expected] of cases) {
      const checker: ProgramChecker = () => {
        throw new Error(message);
      };
      const result = await executeReview(input(), { checker });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const attempt = result.value.execution.attempts[0];
      expect(attempt?.status).toBe("failed");
      expect(attempt?.failure?.message).toBe(expected);
    }
  });

  test("records the finish time for an early checker-output failure", async () => {
    let tick = 0;
    const result = await executeReview(input(), {
      checker: () => ({}) as unknown as ProgramCheckerOutput,
      clock: { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("failed");
    expect(attempt?.startedAt).not.toBe(attempt?.finishedAt);
  });

  test("normalizes evidence once for the checker and its manifest", async () => {
    let seen = "";
    const checker: ProgramChecker = ({ evidence: copied }) => {
      seen = copied[0]?.text ?? "";
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const result = await executeReview(
      input({ evidence: [{ id: "e1", status: "present", text: "a\r\nb \r\n" }] }),
      { checker },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toBe("a\nb\n");
    const item = result.value.execution.attempts[0]?.evidenceBundle?.items[0];
    expect(item?.render?.originalLength).toBe(4);
    expect(item?.render?.renderedLength).toBe(4);
  });

  test("captures a checker exception as a failed attempt", async () => {
    const checker: ProgramChecker = () => {
      throw new Error("checker exploded");
    };
    const result = await executeReview(input(), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("failed");
    expect(attempt?.failure?.code).toBe("checker_error");
    expect(result.value.completeness).toBe("failed");
  });

  test("does not start after a pre-cancelled signal", async () => {
    let calls = 0;
    const checker: ProgramChecker = () => {
      calls += 1;
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const controller = new AbortController();
    controller.abort();
    const result = await executeReview(input({ signal: controller.signal }), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(0);
    expect(result.value.execution.attempts[0]?.status).toBe("not_started");
    expect(result.value.completeness).toBe("not_started");
  });

  test("cancellation keeps completed, cancelled and not_started distinct", async () => {
    const controller = new AbortController();
    const secondStarted = Promise.withResolvers<void>();
    const releaseSecond = Promise.withResolvers<void>();
    let calls = 0;
    const checker: ProgramChecker = async () => {
      calls += 1;
      if (calls === 1) return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
      controller.abort();
      secondStarted.resolve();
      await releaseSecond.promise;
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const pending = executeReview(input({ repetitions: 3, signal: controller.signal }), {
      checker,
    });
    await secondStarted.promise;
    releaseSecond.resolve();
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const statuses = result.value.execution.attempts.map((attempt) => attempt.status);
    expect(statuses).toEqual(["completed", "cancelled", "not_started"]);
    expect(result.value.execution.plannedCount).toBe(3);
    expect(result.value.completeness).toBe("cancelled");
  });

  test("explicit repetitions run sequentially without extra calls", async () => {
    let calls = 0;
    const checker: ProgramChecker = () => {
      calls += 1;
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const result = await executeReview(input({ repetitions: 2 }), { checker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(2);
    expect(result.value.execution.attempts).toHaveLength(2);
    expect(result.value.execution.attempts.every((attempt) => attempt.status === "completed")).toBe(
      true,
    );
  });

  test("an advisory mandatory criterion remains non-required", async () => {
    const checker: ProgramChecker = () => ({
      verdicts: [
        {
          schema: "lorelum.judge.verdict/v1",
          criterionId: "c1",
          verdict: "unmet",
          evidenceIds: ["e1"],
        },
        met("c2", "e2"),
      ],
    });
    const result = await executeReview(
      input({ definition: definition(["advisory", "decisive"]) }),
      { checker },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.value.findings.find((entry) => entry.criterionId === "c1");
    expect(finding?.role).toBe("advisory");
    expect(finding?.required).toBe(false);
  });
});

describe("executeReview with an LLM", () => {
  test("reads one complete code block and records request facts", async () => {
    const model = new ScriptedModel([
      {
        kind: "message",
        content: `\`\`\`json\n${JSON.stringify({
          verdicts: [met("c1", "e1"), met("c2", "e2")],
        })}\n\`\`\``,
        metadata: { provider: "mock", model: "model-1", finishReason: "stop" },
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.config).toEqual({ model: "model-1", temperature: 0, seed: 7 });
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("completed");
    expect(attempt?.llm?.request.model).toBe("model-1");
    expect(attempt?.llm?.response?.model).toBe("model-1");
    expect(result.value.instrument.method.kind).toBe("llm");
  });

  test("the documented verdict shape is accepted", async () => {
    const exampleLine = REVIEW_SYSTEM_PROMPT.split("\n").find((line) =>
      line.startsWith('{"verdicts"'),
    );
    expect(exampleLine).toBeDefined();
    if (exampleLine === undefined) return;
    const example = JSON.parse(exampleLine) as {
      verdicts: Array<Record<string, unknown>>;
    };
    const first = example.verdicts[0];
    if (first === undefined) throw new Error("prompt example has no verdict");
    const model = new ScriptedModel([
      {
        kind: "message",
        content: JSON.stringify({
          verdicts: [
            { ...first, criterionId: "c1", verdict: "met", evidenceIds: ["e1"] },
            { ...first, criterionId: "c2", verdict: "met", evidenceIds: ["e2"] },
          ],
        }),
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.execution.attempts[0]?.status).toBe("completed");
  });

  test("a timeout aborts the underlying model call", async () => {
    let aborted = false;
    const model: ModelPort = {
      generate: ({ signal }) => {
        const { promise, reject } = Promise.withResolvers<ModelResponse>();
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
        return promise;
      },
    };
    const result = await executeReview(input({ method: llmMethod, timeoutMs: 10 }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(aborted).toBe(true);
    expect(result.value.execution.attempts[0]?.failure?.code).toBe("timeout");
  });

  test("malformed model metadata is omitted and recorded as unknown", async () => {
    const model = new ScriptedModel([
      {
        kind: "message",
        content: JSON.stringify({
          verdicts: [met("c1", "e1"), met("c2", "e2")],
        }),
        metadata: {
          provider: "",
          model: "model-1\uD800",
          finishReason: "stop",
          usage: { promptTokens: 1.5, completionTokens: 2, totalTokens: 3.5 },
        },
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("completed");
    expect(attempt?.llm?.response?.provider).toBeUndefined();
    expect(attempt?.llm?.response?.model).toBeUndefined();
    expect(attempt?.llm?.response?.usage).toEqual({ completionTokens: 2 });
    expect(attempt?.llm?.unknowns).toContain("response_metadata_invalid");
  });

  test("malformed JSON fails without a second call", async () => {
    const model = new ScriptedModel([
      { kind: "message", content: "not json" },
      {
        kind: "message",
        content: JSON.stringify({ verdicts: [met("c1", "e1"), met("c2", "e2")] }),
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(model.requests).toHaveLength(1);
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("failed");
    expect(attempt?.failure?.code).toBe("malformed_json");
  });

  test("duplicate JSON keys are refused", async () => {
    const model = new ScriptedModel([
      {
        kind: "message",
        content: '{"verdicts":[],"verdicts":[]}',
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.execution.attempts[0]?.failure?.code).toBe("duplicate_key");
  });

  test("evidence references and verdict kinds stay per-item", async () => {
    const model = new ScriptedModel([
      {
        kind: "message",
        content: JSON.stringify({
          verdicts: [
            {
              schema: "lorelum.judge.verdict/v1",
              criterionId: "c1",
              verdict: "better",
              evidenceIds: ["e2"],
            },
            {
              schema: "lorelum.judge.verdict/v1",
              criterionId: "c2",
              verdict: "met",
              evidenceIds: ["e2"],
            },
          ],
        }),
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("partial");
    expect(attempt?.verdicts?.map((verdict) => verdict.criterionId)).toEqual(["c2"]);
    const codes = attempt?.issues?.map((issue) => issue.code) ?? [];
    expect(codes).toContain("evidence_not_declared");
    expect(codes).toContain("verdict_not_allowed");
  });

  test("a provider failure keeps the request facts and no run", async () => {
    const model = new ScriptedModel([new Error("transport exploded")]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attempt = result.value.execution.attempts[0];
    expect(attempt?.status).toBe("failed");
    expect(attempt?.run).toBeUndefined();
    expect(attempt?.llm?.request.model).toBe("model-1");
    expect(attempt?.failure?.category).toBe("provider");
  });

  test("a truncated response is a distinct failure", async () => {
    const model = new ScriptedModel([
      {
        kind: "message",
        content: '{"verdicts":[]}',
        metadata: { finishReason: "length" },
      },
    ]);
    const result = await executeReview(input({ method: llmMethod }), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.execution.attempts[0]?.failure?.code).toBe("truncated_response");
  });
});

describe("executeReview validation", () => {
  test("invalid input returns issues before any call", async () => {
    let calls = 0;
    const checker: ProgramChecker = () => {
      calls += 1;
      return { verdicts: [] };
    };
    const result = await executeReview(
      input({
        definition: {
          schema: "lorelum.judge.measurement-definition/v2",
          id: "bad",
          criteria: [],
          metadata: [],
        },
      }),
      { checker },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("rejects an invalid optional id or signal before execution", async () => {
    let calls = 0;
    const checker: ProgramChecker = () => {
      calls += 1;
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    for (const id of [42, "", null, "\uD800"]) {
      const invalidId = input({ id } as unknown as ExecuteReviewInput);
      expect((await executeReview(invalidId, { checker })).ok).toBe(false);
    }
    for (const signal of [{}, 42, null]) {
      const invalidSignal = input({ signal } as unknown as ExecuteReviewInput);
      expect((await executeReview(invalidSignal, { checker })).ok).toBe(false);
    }
    expect(calls).toBe(0);
  });

  test("a missing checker port is rejected without execution", async () => {
    const result = await executeReview(input(), {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.message).join(" ")).toContain("checker port");
    }
  });

  test("unsupported decoding is refused", async () => {
    const result = await executeReview(
      input({
        method: {
          ...llmMethod,
          decoding: { temperature: 0, frequencyPenalty: 1 },
        } as ReviewMethodInput,
      }),
      { model: new ScriptedModel([]) },
    );
    expect(result.ok).toBe(false);
  });
});
