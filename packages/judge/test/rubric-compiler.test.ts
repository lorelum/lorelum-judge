import { describe, expect, test } from "bun:test";

import type { JsonValue, ModelPort, ModelRequest, ModelResponse } from "@lorelum/judge-runtime";

import {
  type CompileIssue,
  type CompileRubricInput,
  compileRubric,
  freezeRubric,
  isComplete,
} from "../src/index.js";

const ID = `sha256:${"a".repeat(64)}`;

const contract = {
  schema: "lorelum.judge.task-contract/v1",
  id: "t1",
  taskClass: "cli",
  text: "Add --json output",
  acceptance: [
    { id: "a1", text: "prints json", source: { origin: "user", ref: "r1" } },
    { id: "a2", text: "exits 0", source: { origin: "user", ref: "r2" } },
  ],
};

function criterion(id: string, covers: string[], overrides: Record<string, unknown> = {}) {
  return {
    schema: "lorelum.judge.criterion/v1",
    id,
    kind: "contract",
    description: `check ${id}`,
    mandatory: false,
    anchors: [
      { verdict: "met", description: "done" },
      { verdict: "unmet", description: "not done" },
    ],
    // One primary owner per acceptance id: the protocol forbids two primary owners of one evidence.
    evidence: covers.map((evidenceId) => ({ evidenceId, role: "primary" })),
    ...overrides,
  };
}

function proposal(
  id: string,
  covers: string[],
  options: {
    criterion?: Record<string, unknown>;
    appliesTo?: string[];
    mergedFrom?: string[];
  } = {},
) {
  return {
    criterion: criterion(id, covers, options.criterion),
    covers,
    appliesTo: options.appliesTo ?? ["cli"],
    role: "decisive",
    ...(options.mergedFrom === undefined ? {} : { mergedFrom: options.mergedFrom }),
  };
}

function structured(value: unknown): ModelResponse {
  return { kind: "structured", value: value as JsonValue };
}

function fakeModel(response: ModelResponse | Error) {
  const requests: ModelRequest[] = [];
  const model: ModelPort = {
    async generate(request) {
      requests.push(request);
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
  return { model, requests };
}

function input(model: ModelPort, overrides: Partial<CompileRubricInput> = {}): CompileRubricInput {
  return {
    rubricId: "r1",
    contract,
    prompt: {
      system: "Judge the work.",
      template: "Acceptance items:\n{{evidence}}",
      variables: {},
      evidenceBudget: 10000,
      ruleBudget: 10000,
    },
    instrument: {
      schema: "lorelum.judge.instrument-profile/v1",
      model: { provider: "fake", name: "m1" },
      decoding: { temperature: 0 },
      runtime: { name: "reference", version: "1" },
      repetitions: 1,
    },
    contextIdentity: ID,
    policyIdentity: ID,
    model,
    runId: "run1",
    stepIndex: 0,
    signal: new AbortController().signal,
    ...overrides,
  } as CompileRubricInput;
}

function issueCodes(issues: readonly CompileIssue[]): string[] {
  return issues.map((issue) => `${issue.category}:${issue.code}`);
}

const complete = {
  proposals: [proposal("c1", ["a1"]), proposal("c2", ["a2"])],
  unsupported: [],
};

describe("generation", () => {
  test("a complete proposal compiles and freezes with a new identity", async () => {
    const { model, requests } = fakeModel(structured(complete));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requests.length).toBe(1);
    expect(requests[0]?.runId).toBe("run1");
    expect(requests[0]?.stepIndex).toBe(0);
    expect(result.value.rubric.status).toBe("proposal");
    expect(result.value.rubric.entries.length).toBe(2);
    expect(isComplete(result.value.report)).toBe(true);

    const frozen = freezeRubric(result.value);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.rubric.status).toBe("frozen");
    expect(frozen.rubricIdentity).not.toBe(result.value.rubricIdentity);
  });

  test("a message response is an output failure", async () => {
    const { model } = fakeModel({ kind: "message", content: "here is a rubric" });
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toEqual(["output:not_structured"]);
  });

  test("a model error is a model failure and does not throw", async () => {
    const { model } = fakeModel(new Error("provider down"));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toEqual(["model:model_error"]);
    expect(result.issues[0]?.message).toContain("provider down");
  });

  test("an aborted signal fails before the model is called", async () => {
    const { model, requests } = fakeModel(structured(complete));
    const controller = new AbortController();
    controller.abort();
    const result = await compileRubric(input(model, { signal: controller.signal }));
    expect(requests.length).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toEqual(["model:aborted"]);
  });

  test("a contract over the evidence budget fails and the model is not called", async () => {
    const { model, requests } = fakeModel(structured(complete));
    const base = input(model);
    const result = await compileRubric({ ...base, prompt: { ...base.prompt, evidenceBudget: 3 } });
    expect(requests.length).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.every((issue) => issue.category === "prompt")).toBe(true);
  });

  test("a malformed proposal is an output failure at its criterion path", async () => {
    const bad = {
      criterion: { ...criterion("c1", ["a1"]), kind: "nonsense" },
      covers: ["a1"],
      appliesTo: ["cli"],
      role: "decisive",
    };
    const { model } = fakeModel(structured({ proposals: [bad], unsupported: [] }));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (issue) => issue.category === "output" && issue.path.startsWith("$.proposals[0].criterion"),
      ),
    ).toBe(true);
  });

  test("a hostile response does not throw", async () => {
    const hostile: Record<string, unknown> = { unsupported: [] };
    Object.defineProperty(hostile, "proposals", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const { model } = fakeModel(structured(hostile));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toEqual(["output:unreadable"]);
  });
});

describe("gate", () => {
  test("an acceptance cannot be both covered and declared unsupported", async () => {
    const proposals = [proposal("c1", ["a1"]), proposal("c2", ["a2"])];
    const { model } = fakeModel(
      structured({ proposals, unsupported: [{ acceptanceId: "a2", reason: "needs a browser" }] }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toEqual(["gate:unsupported_and_covered"]);
  });

  test("a covers id that is not in the contract fails the whole compilation", async () => {
    const proposals = [proposal("c1", ["a1", "a9"]), proposal("c2", ["a2"])];
    const { model } = fakeModel(structured({ proposals, unsupported: [] }));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "gate",
        code: "unknown_acceptance",
        path: "$.proposals[0].covers[1]",
      }),
    );
  });

  test("a mandatory criterion with an untrusted source is rejected", async () => {
    const mandatory = proposal("c1", ["a1"], {
      criterion: { mandatory: true, source: { origin: "decision", ref: "d1" } },
    });
    const { model } = fakeModel(
      structured({ proposals: [mandatory, proposal("c2", ["a2"])], unsupported: [] }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toEqual(["gate:missing_source"]);
  });

  test("a criterion for another task class is excluded and kept out of the rubric", async () => {
    const web = proposal("w1", ["a1"], { appliesTo: ["web"] });
    const { model } = fakeModel(
      structured({
        proposals: [web, proposal("c1", ["a1"]), proposal("c2", ["a2"])],
        unsupported: [],
      }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.excluded).toEqual([
      expect.objectContaining({ criterionId: "w1", code: "not_applicable" }),
    ]);
    expect(result.value.rubric.entries.map((entry) => entry.criterion.id)).toEqual(["c1", "c2"]);
    expect(isComplete(result.value.report)).toBe(true);
  });

  test("a declared merge is recorded and the merged criterion leaves the rubric", async () => {
    const survivor = proposal("c2", ["a1", "a2"], { mergedFrom: ["c1"] });
    const { model } = fakeModel(
      structured({ proposals: [proposal("c1", ["a1"]), survivor], unsupported: [] }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.merged).toEqual([{ criterionId: "c2", mergedFrom: ["c1"] }]);
    expect(result.value.rubric.entries.map((entry) => entry.criterion.id)).toEqual(["c2"]);
    expect(isComplete(result.value.report)).toBe(true);
  });

  test("undeclared overlap is a conflict, excludes both, and blocks freezing", async () => {
    const proposals = [proposal("c1", ["a1"]), proposal("c2", ["a1"]), proposal("c3", ["a2"])];
    const { model } = fakeModel(structured({ proposals, unsupported: [] }));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conflicts = result.value.report.excluded
      .filter((item) => item.code === "conflict")
      .map((item) => item.criterionId);
    expect(conflicts.sort()).toEqual(["c1", "c2"]);
    expect(result.value.rubric.entries.map((entry) => entry.criterion.id)).toEqual(["c3"]);
    expect(result.value.report.uncovered.map((gap) => gap.acceptanceId)).toEqual(["a1"]);
    expect(isComplete(result.value.report)).toBe(false);
    expect(freezeRubric(result.value).ok).toBe(false);
  });

  test("when every criterion conflicts, the conflict reasons are reported", async () => {
    const { model } = fakeModel(
      structured({ proposals: [proposal("c1", ["a1"]), proposal("c2", ["a1"])], unsupported: [] }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toContain("gate:conflict");
    expect(issueCodes(result.issues)).toContain("gate:empty_rubric");
  });

  test("an uncovered acceptance blocks freezing and is named", async () => {
    const { model } = fakeModel(
      structured({ proposals: [proposal("c1", ["a1"])], unsupported: [] }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.uncovered.map((gap) => gap.acceptanceId)).toEqual(["a2"]);
    const frozen = freezeRubric(result.value);
    expect(frozen.ok).toBe(false);
    if (frozen.ok) return;
    expect(frozen.issues).toContainEqual(
      expect.objectContaining({ code: "incomplete", message: expect.stringContaining("a2") }),
    );
  });

  test("a declared unsupported acceptance is reported and blocks freezing", async () => {
    const { model } = fakeModel(
      structured({
        proposals: [proposal("c1", ["a1"])],
        unsupported: [{ acceptanceId: "a2", reason: "needs a browser" }],
      }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.unsupported).toEqual([
      { acceptanceId: "a2", reason: "needs a browser" },
    ]);
    expect(result.value.report.uncovered).toEqual([]);
    expect(isComplete(result.value.report)).toBe(false);
  });

  test("a criterion without anchors compiles as a proposal but does not freeze", async () => {
    const { model } = fakeModel(
      structured({
        proposals: [proposal("c1", ["a1"], { criterion: { anchors: [] } }), proposal("c2", ["a2"])],
        unsupported: [],
      }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frozen = freezeRubric(result.value);
    expect(frozen.ok).toBe(false);
    if (frozen.ok) return;
    expect(issueCodes(frozen.issues)).toEqual(["gate:no_anchors"]);
  });

  test("when no criterion applies, the compilation fails as empty", async () => {
    const { model } = fakeModel(
      structured({ proposals: [proposal("c1", ["a1"], { appliesTo: ["web"] })], unsupported: [] }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(issueCodes(result.issues)).toContain("gate:empty_rubric");
  });
});

describe("identity", () => {
  test("a different model identity changes the rubric identity", async () => {
    const first = await compileRubric(input(fakeModel(structured(complete)).model));
    const base = input(fakeModel(structured(complete)).model);
    const second = await compileRubric({
      ...base,
      instrument: { ...base.instrument, model: { provider: "fake", name: "m2" } },
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.rubricIdentity).not.toBe(first.value.rubricIdentity);
  });
});
