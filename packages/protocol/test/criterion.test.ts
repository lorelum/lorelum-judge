import { describe, expect, test } from "bun:test";

import {
  type Criterion,
  validateCriteria,
  validateCriterion,
  validateVerdict,
} from "../src/index.js";

function criterion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.criterion/v1",
    id: "c1",
    kind: "contract",
    description: "The endpoint returns the documented status codes",
    mandatory: false,
    anchors: [
      { verdict: "met", description: "all documented codes are returned" },
      { verdict: "unmet", description: "a documented code is missing or wrong" },
    ],
    evidence: [{ evidenceId: "e1", role: "primary" }],
    ...overrides,
  };
}

function valid(overrides: Record<string, unknown> = {}): Criterion {
  const result = validateCriterion(criterion(overrides));
  if (!result.ok) {
    throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function verdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId: "c1",
    verdict: "met",
    evidenceIds: ["e1"],
    ...overrides,
  };
}

function codes(result: { ok: boolean; issues?: readonly { code: string }[] }): string[] {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code);
}

describe("criterion anchors", () => {
  test("accepts anchors that cover every decisive verdict", () => {
    expect(validateCriterion(criterion()).ok).toBe(true);
    expect(
      validateCriterion(
        criterion({
          kind: "quality",
          anchors: [
            { verdict: "strong", description: "a" },
            { verdict: "adequate", description: "b" },
            { verdict: "weak", description: "c" },
          ],
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateCriterion(
        criterion({
          kind: "comparison",
          anchors: [
            { verdict: "better", description: "a" },
            { verdict: "equivalent", description: "b" },
            { verdict: "worse", description: "c" },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  test("rejects a missing anchor", () => {
    const result = validateCriterion(
      criterion({
        kind: "quality",
        anchors: [
          { verdict: "strong", description: "a" },
          { verdict: "weak", description: "c" },
        ],
      }),
    );
    expect(codes(result)).toEqual(["anchor_mismatch"]);
  });

  test("rejects an anchor from another kind and a duplicate anchor", () => {
    const foreign = validateCriterion(
      criterion({
        anchors: [
          { verdict: "met", description: "a" },
          { verdict: "unmet", description: "b" },
          { verdict: "strong", description: "c" },
        ],
      }),
    );
    expect(codes(foreign)).toEqual(["anchor_mismatch"]);

    const duplicate = validateCriterion(
      criterion({
        anchors: [
          { verdict: "met", description: "a" },
          { verdict: "met", description: "b" },
          { verdict: "unmet", description: "c" },
        ],
      }),
    );
    expect(codes(duplicate)).toEqual(["anchor_mismatch"]);
  });
});

describe("mandatory criterion source", () => {
  test("rejects a mandatory criterion without a source", () => {
    const result = validateCriterion(criterion({ mandatory: true }));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("schema");
  });

  test("accepts a mandatory criterion with a source and an optional one without", () => {
    expect(
      validateCriterion(criterion({ mandatory: true, source: { origin: "contract", ref: "AC-1" } }))
        .ok,
    ).toBe(true);
    expect(validateCriterion(criterion({ mandatory: false })).ok).toBe(true);
  });

  test("rejects an unknown source origin", () => {
    expect(
      validateCriterion(
        criterion({ mandatory: true, source: { origin: "unknown-origin", ref: "x" } }),
      ).ok,
    ).toBe(false);
  });

  test("rejects an empty source origin", () => {
    expect(
      validateCriterion(criterion({ mandatory: true, source: { origin: "", ref: "x" } })).ok,
    ).toBe(false);
  });

  test("rejects an empty source ref", () => {
    expect(
      validateCriterion(criterion({ mandatory: true, source: { origin: "user", ref: "" } })).ok,
    ).toBe(false);
  });
});

describe("issue paths", () => {
  test("schema issues use the same path format as semantic issues", () => {
    const result = validateCriterion(
      criterion({
        anchors: [
          { verdict: "met", description: "a" },
          { verdict: "bogus", description: "b" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContain("$.anchors[1].verdict");
      for (const issue of result.issues) {
        expect(issue.path).not.toMatch(/\.\d/);
      }
    }
  });

  test("a top-level schema failure reports the root path", () => {
    const result = validateCriterion(criterion({ mandatory: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.every((issue) => issue.path === "$")).toBe(true);
    }
  });

  test("criteria set paths nest the criterion path under its index", () => {
    const result = validateCriteria([
      criterion(),
      criterion({
        id: "c2",
        anchors: [
          { verdict: "met", description: "a" },
          { verdict: "bogus", description: "b" },
        ],
      }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContain("$[1].anchors[1].verdict");
    }
  });
});

describe("duplicate evidence in one criterion", () => {
  test("rejects the same evidence declared as primary and reference", () => {
    const result = validateCriterion(
      criterion({
        evidence: [
          { evidenceId: "e1", role: "primary" },
          { evidenceId: "e1", role: "reference" },
        ],
      }),
    );
    expect(codes(result)).toEqual(["duplicate_evidence"]);
  });

  test("rejects the same evidence declared twice as primary", () => {
    const result = validateCriterion(
      criterion({
        evidence: [
          { evidenceId: "e1", role: "primary" },
          { evidenceId: "e1", role: "primary" },
        ],
      }),
    );
    expect(codes(result)).toEqual(["duplicate_evidence"]);
  });

  test("accepts distinct evidence ids", () => {
    expect(
      validateCriterion(
        criterion({
          evidence: [
            { evidenceId: "e1", role: "primary" },
            { evidenceId: "e2", role: "reference" },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("verdict with an unvalidated criterion", () => {
  const inputs: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["unknown kind", criterion({ kind: "bogus" })],
  ];

  test.each(inputs)("returns invalid_criterion for %s without throwing", (_name, bad) => {
    expect(() => validateVerdict(bad, verdict())).not.toThrow();
    const result = validateVerdict(bad, verdict());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.every((issue) => issue.code === "invalid_criterion")).toBe(true);
      expect(result.issues.every((issue) => issue.path.startsWith("criterion"))).toBe(true);
    }
  });
});

describe("evidence ownership", () => {
  test("rejects two primary owners of the same evidence", () => {
    const result = validateCriteria([
      criterion({ id: "c1" }),
      criterion({ id: "c2", evidence: [{ evidenceId: "e1", role: "primary" }] }),
    ]);
    expect(codes(result)).toEqual(["duplicate_primary_evidence"]);
  });

  test("accepts one primary owner with several references", () => {
    const result = validateCriteria([
      criterion({ id: "c1" }),
      criterion({ id: "c2", evidence: [{ evidenceId: "e1", role: "reference" }] }),
      criterion({ id: "c3", evidence: [{ evidenceId: "e1", role: "reference" }] }),
    ]);
    expect(result.ok).toBe(true);
  });

  test("rejects a duplicate criterion id", () => {
    const result = validateCriteria([
      criterion({ id: "c1" }),
      criterion({ id: "c1", evidence: [{ evidenceId: "e2", role: "primary" }] }),
    ]);
    expect(codes(result)).toEqual(["duplicate_criterion"]);
  });

  test("reports the index of an invalid criterion in the set", () => {
    const result = validateCriteria([criterion(), criterion({ id: "" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path.startsWith("$[1]")).toBe(true);
    }
  });

  test("a criterion with no evidence is valid", () => {
    expect(validateCriterion(criterion({ evidence: [] })).ok).toBe(true);
  });
});

describe("verdict", () => {
  test("accepts a decisive verdict citing declared evidence", () => {
    expect(validateVerdict(valid(), verdict()).ok).toBe(true);
  });

  test("rejects a decisive verdict with no evidence rather than treating it as a failure", () => {
    const result = validateVerdict(valid(), verdict({ verdict: "unmet", evidenceIds: [] }));
    expect(codes(result)).toEqual(["verdict_without_evidence"]);
  });

  test.each(["unknown", "insufficient"])("accepts %s without evidence", (value) => {
    expect(validateVerdict(valid(), verdict({ verdict: value, evidenceIds: [] })).ok).toBe(true);
  });

  test("rejects a verdict from another kind", () => {
    const result = validateVerdict(valid(), verdict({ verdict: "strong" }));
    expect(codes(result)).toEqual(["verdict_not_allowed"]);
  });

  test("rejects evidence the criterion does not declare", () => {
    const result = validateVerdict(valid(), verdict({ evidenceIds: ["e1", "e9"] }));
    expect(codes(result)).toEqual(["evidence_not_declared"]);
  });

  test("accepts a referenced evidence id", () => {
    const referencing = valid({ evidence: [{ evidenceId: "e7", role: "reference" }] });
    expect(validateVerdict(referencing, verdict({ evidenceIds: ["e7"] })).ok).toBe(true);
  });

  test("rejects a verdict that belongs to another criterion", () => {
    const result = validateVerdict(valid(), verdict({ criterionId: "other" }));
    expect(codes(result)).toEqual(["criterion_mismatch"]);
  });

  test("rejects repeated evidence ids", () => {
    expect(validateVerdict(valid(), verdict({ evidenceIds: ["e1", "e1"] })).ok).toBe(false);
  });
});

describe("invalid input", () => {
  const inputs: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 1],
    ["string", "x"],
    ["array", []],
    ["function", () => 1],
  ];

  test.each(inputs)("does not throw for %s", (_name, input) => {
    expect(() => validateCriterion(input)).not.toThrow();
    expect(validateCriterion(input).ok).toBe(false);
    expect(() => validateVerdict(valid(), input)).not.toThrow();
    expect(validateVerdict(valid(), input).ok).toBe(false);
  });

  test("rejects unknown fields and a wrong schema identifier", () => {
    expect(validateCriterion(criterion({ extra: 1 })).ok).toBe(false);
    expect(validateCriterion(criterion({ schema: "lorelum.judge.criterion/v2" })).ok).toBe(false);
  });

  test("rejects a non-array criteria set", () => {
    expect(validateCriteria({}).ok).toBe(false);
  });

  test("issues carry path, code, and message only", () => {
    const result = validateCriterion(criterion({ id: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const issue of result.issues) {
        expect(Object.keys(issue).sort()).toEqual(["code", "message", "path"]);
      }
    }
  });
});
