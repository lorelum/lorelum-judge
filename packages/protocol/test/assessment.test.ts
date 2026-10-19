import { describe, expect, test } from "bun:test";

import {
  assessVerdicts,
  type Criterion,
  type EvidenceBundle,
  validateCriterion,
} from "../src/index.js";

function criterion(id: string, evidenceId: string): Criterion {
  const checked = validateCriterion({
    schema: "lorelum.judge.criterion/v1",
    id,
    kind: "contract",
    description: `criterion ${id}`,
    mandatory: true,
    source: { origin: "contract", ref: `AC-${id}` },
    anchors: [
      { verdict: "met", description: "satisfied" },
      { verdict: "unmet", description: "not satisfied" },
    ],
    evidence: [{ evidenceId, role: "primary" }],
  });
  if (!checked.ok) throw new Error("fixture criterion invalid");
  return checked.value;
}

function verdict(criterionId: string, evidenceId: string, value: "met" | "unmet" = "met") {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId,
    verdict: value,
    evidenceIds: [evidenceId],
  };
}

const bundle: EvidenceBundle = {
  schema: "lorelum.judge.evidence-bundle/v1",
  items: [
    {
      schema: "lorelum.judge.evidence-item/v1",
      id: "e1",
      status: "present",
      contentIdentity: `sha256:${"a".repeat(64)}`,
      render: { state: "rendered", originalLength: 1, renderedLength: 1 },
    },
    {
      schema: "lorelum.judge.evidence-item/v1",
      id: "e2",
      status: "present",
      contentIdentity: `sha256:${"b".repeat(64)}`,
      render: { state: "rendered", originalLength: 1, renderedLength: 1 },
    },
  ],
};

describe("assessVerdicts", () => {
  test("excludes a duplicate group as a whole and ignores unknown criteria", () => {
    const result = assessVerdicts(
      [criterion("c1", "e1")],
      [verdict("c1", "e1"), verdict("c1", "e1", "unmet"), verdict("missing", "e1")],
    );
    expect(result.verdicts).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unknown_criterion",
      "duplicate_verdict",
      "duplicate_verdict",
    ]);
  });

  test("reports missing coverage only when requireAll is set", () => {
    const optional = assessVerdicts([criterion("c1", "e1")], []);
    expect(optional.issues).toEqual([]);
    const required = assessVerdicts([criterion("c1", "e1")], [], { requireAll: true });
    expect(required.issues.map((issue) => issue.code)).toEqual(["missing_verdict"]);
  });

  test("validates evidence references against the supplied bundle", () => {
    const result = assessVerdicts([criterion("c1", "e1")], [verdict("c1", "e2")], {
      bundle,
    });
    expect(result.verdicts).toEqual([]);
    expect(result.issues.some((issue) => issue.code === "evidence_not_declared")).toBe(true);
  });

  test("keeps a legal verdict and preserves its evidence", () => {
    const result = assessVerdicts([criterion("c1", "e1")], [verdict("c1", "e1")], {
      bundle,
      requireAll: true,
      path: "$.observations[0].verdicts",
    });
    expect(result.issues).toEqual([]);
    expect(result.verdicts[0]?.evidenceIds).toEqual(["e1"]);
  });
});
