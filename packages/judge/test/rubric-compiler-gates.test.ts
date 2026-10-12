import { describe, expect, test } from "bun:test";

import type { JsonValue, ModelPort, ModelResponse } from "@lorelum/judge-runtime";

import {
  type CompileIssue,
  type CompileRubricInput,
  compileRubric,
  freezeRubric,
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

function criterion(
  id: string,
  evidence: { evidenceId: string; role: "primary" | "reference" }[],
  extra: Record<string, unknown> = {},
) {
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
    evidence,
    ...extra,
  };
}

/** A proposal whose evidence is primary for each covered id, unless `evidence` is given. */
function proposal(
  id: string,
  covers: string[],
  options: {
    evidence?: { evidenceId: string; role: "primary" | "reference" }[];
    criterion?: Record<string, unknown>;
    mergedFrom?: string[];
  } = {},
) {
  const evidence =
    options.evidence ?? covers.map((evidenceId) => ({ evidenceId, role: "primary" as const }));
  return {
    criterion: criterion(id, evidence, options.criterion),
    covers,
    appliesTo: ["cli"],
    role: "decisive",
    ...(options.mergedFrom === undefined ? {} : { mergedFrom: options.mergedFrom }),
  };
}

function modelWith(response: ModelResponse, onCall?: () => void): ModelPort {
  return {
    async generate() {
      onCall?.();
      return response;
    },
  };
}

function structured(value: unknown): ModelResponse {
  return { kind: "structured", value: value as JsonValue };
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

function codes(issues: readonly CompileIssue[]): string[] {
  return issues.map((issue) => `${issue.category}:${issue.code}`);
}

describe("evidence references", () => {
  test("an evidence selector that is not an acceptance id is a gate failure", async () => {
    const bad = proposal("c1", ["a1"], {
      evidence: [
        { evidenceId: "zz", role: "primary" },
        { evidenceId: "a1", role: "primary" },
      ],
    });
    const result = await compileRubric(
      input(modelWith(structured({ proposals: [bad, proposal("c2", ["a2"])], unsupported: [] }))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toContain("gate:unknown_evidence");
  });

  test("a covered acceptance must have its own evidence selector", async () => {
    const weak = proposal("c1", ["a1"], { evidence: [{ evidenceId: "a2", role: "reference" }] });
    const result = await compileRubric(
      input(modelWith(structured({ proposals: [weak, proposal("c2", ["a2"])], unsupported: [] }))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toContain("gate:covers_without_evidence");
  });

  test("two criteria cannot be primary owners of the same evidence", async () => {
    const c2 = proposal("c2", ["a2"], {
      evidence: [
        { evidenceId: "a1", role: "primary" },
        { evidenceId: "a2", role: "primary" },
      ],
    });
    const result = await compileRubric(
      input(modelWith(structured({ proposals: [proposal("c1", ["a1"]), c2], unsupported: [] }))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toContain("gate:duplicate_primary_evidence");
  });
});

describe("merge", () => {
  test("a mandatory criterion merged into a non-mandatory survivor is rejected", async () => {
    const member = proposal("c1", ["a1"], {
      criterion: { mandatory: true, source: { origin: "user", ref: "r1" } },
    });
    const survivor = proposal("c2", ["a1", "a2"], { mergedFrom: ["c1"] });
    const result = await compileRubric(
      input(modelWith(structured({ proposals: [member, survivor], unsupported: [] }))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toContain("gate:merge_drops_mandatory");
  });
});

describe("model response", () => {
  test("a response whose kind cannot be read is an output failure, not an internal error", async () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "kind", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const result = await compileRubric(input(modelWith(hostile as unknown as ModelResponse)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toEqual(["output:unreadable"]);
  });

  test("an abort during the model call fails with category model", async () => {
    const controller = new AbortController();
    const model = modelWith(
      structured({ proposals: [proposal("c1", ["a1"]), proposal("c2", ["a2"])], unsupported: [] }),
      () => controller.abort(),
    );
    const result = await compileRubric(input(model, { signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toEqual(["model:aborted"]);
  });
});

describe("identities", () => {
  test("a context identity that is not a sha256 identity fails before the model is called", async () => {
    let calls = 0;
    const model = modelWith(
      structured({ proposals: [proposal("c1", ["a1"]), proposal("c2", ["a2"])], unsupported: [] }),
      () => {
        calls += 1;
      },
    );
    const result = await compileRubric(input(model, { contextIdentity: "not-a-hash" }));
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toEqual(["gate:invalid_identity"]);
  });
});

describe("empty results keep their reasons", () => {
  test("when everything is unsupported, the unsupported reasons are reported with the empty failure", async () => {
    const model = modelWith(
      structured({
        proposals: [proposal("c1", ["a1"], { criterion: {} })].map((item) => ({
          ...item,
          appliesTo: ["web"],
        })),
        unsupported: [
          { acceptanceId: "a1", reason: "needs a browser" },
          { acceptanceId: "a2", reason: "needs a server" },
        ],
      }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.issues)).toContain("gate:empty_rubric");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported",
        message: expect.stringContaining("needs a browser"),
      }),
    );
  });
});

describe("freezing", () => {
  test("freezing refuses a report that does not match the rubric, even if it claims complete", async () => {
    const model = modelWith(structured({ proposals: [proposal("c1", ["a1"])], unsupported: [] }));
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const forged = { ...result.value, report: { ...result.value.report, uncovered: [] } };
    expect(freezeRubric(forged).ok).toBe(false);
  });
});

describe("optional fields", () => {
  test("an empty mergedFrom is the same as none", async () => {
    const model = modelWith(
      structured({
        proposals: [proposal("c1", ["a1"], { mergedFrom: [] }), proposal("c2", ["a2"])],
        unsupported: [],
      }),
    );
    const result = await compileRubric(input(model));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.merged).toEqual([]);
    expect(result.value.rubric.entries.length).toBe(2);
  });
});

describe("single reads", () => {
  test("a role getter that changes on later reads cannot drop a proposal silently", async () => {
    let reads = 0;
    const flipping = proposal("c1", ["a1"]);
    Object.defineProperty(flipping, "role", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "decisive" : "bogus";
      },
    });
    const result = await compileRubric(
      input(
        modelWith(structured({ proposals: [flipping, proposal("c2", ["a2"])], unsupported: [] })),
      ),
    );
    if (result.ok) {
      expect(result.value.rubric.entries.map((entry) => entry.criterion.id)).toContain("c1");
    } else {
      expect(result.issues.some((issue) => issue.category === "output")).toBe(true);
    }
    expect(reads).toBe(1);
  });
});

describe("conflict follows #41", () => {
  test("partial overlap is kept, and the covered acceptance lists both criteria", async () => {
    const c1 = proposal("c1", ["a1"]);
    const c2 = proposal("c2", ["a1", "a2"], {
      evidence: [
        { evidenceId: "a1", role: "reference" },
        { evidenceId: "a2", role: "primary" },
      ],
    });
    const result = await compileRubric(
      input(modelWith(structured({ proposals: [c1, c2], unsupported: [] }))),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.excluded).toEqual([]);
    expect(result.value.report.covered).toContainEqual({
      acceptanceId: "a1",
      criterionIds: ["c1", "c2"],
    });
  });
});

describe("freeze accepts only compiled results", () => {
  test("a hand-built compiled object is refused", async () => {
    const result = await compileRubric(
      input(
        modelWith(
          structured({
            proposals: [proposal("c1", ["a1"]), proposal("c2", ["a2"])],
            unsupported: [],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = { ...result.value };
    const refused = freezeRubric(copy);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.issues.map((issue) => issue.code)).toEqual(["not_compiled"]);
  });

  test("a compiled result cannot be changed in place", async () => {
    const result = await compileRubric(
      input(modelWith(structured({ proposals: [proposal("c1", ["a1"])], unsupported: [] }))),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => {
      (result.value as { report: unknown }).report = { ...result.value.report, uncovered: [] };
    }).toThrow();
    expect(freezeRubric(result.value).ok).toBe(false);
  });
});

describe("review round 3", () => {
  test("a surviving criterion that conflicts is excluded, not reported as merged", async () => {
    const member = proposal("m", ["a1"]);
    const survivor = proposal("s", ["a1"], { mergedFrom: ["m"] });
    const rival = proposal("r", ["a1"]);
    const result = await compileRubric(
      input(
        modelWith(
          structured({
            proposals: [member, survivor, rival, proposal("c3", ["a2"])],
            unsupported: [],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.merged).toEqual([]);
    expect(
      result.value.report.excluded.map((item) => `${item.criterionId}:${item.code}`).sort(),
    ).toEqual(["m:conflict", "r:conflict", "s:conflict"]);
    expect(result.value.report.uncovered.map((gap) => gap.acceptanceId)).toEqual(["a1"]);
  });

  test("an array hole in the proposals is reported, not skipped", async () => {
    const holed: unknown[] = new Array<unknown>(3);
    holed[1] = proposal("c1", ["a1"]);
    holed[2] = proposal("c2", ["a2"]);
    const result = await compileRubric(
      input(modelWith(structured({ proposals: holed, unsupported: [] }))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.category === "output" && issue.path === "$.proposals[0]"),
    ).toBe(true);
  });
});

describe("review round 4", () => {
  test("a context identity getter is read once, and that value is the one checked and bound", async () => {
    const base = input(
      modelWith(
        structured({
          proposals: [proposal("c1", ["a1"]), proposal("c2", ["a2"])],
          unsupported: [],
        }),
      ),
    );
    let reads = 0;
    const flipping = { ...base };
    Object.defineProperty(flipping, "contextIdentity", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? ID : "bogus";
      },
    });
    const result = await compileRubric(flipping as CompileRubricInput);
    expect(reads).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.binding.contextIdentity).toBe(ID);
  });

  test("an instrument whose field throws is reported at the instrument path", async () => {
    const base = input(
      modelWith(
        structured({
          proposals: [proposal("c1", ["a1"]), proposal("c2", ["a2"])],
          unsupported: [],
        }),
      ),
    );
    const broken: Record<string, unknown> = { ...base.instrument };
    Object.defineProperty(broken, "repetitions", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const result = await compileRubric({ ...base, instrument: broken } as CompileRubricInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ category: "gate", path: "$.instrument", code: "unreadable" }),
    );
  });
});
