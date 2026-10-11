import { describe, expect, test } from "bun:test";

import {
  evidenceBundleIdentity,
  validateEvidenceBundle,
  validateVerdictEvidence,
} from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

interface Outcome {
  readonly ok: boolean;
  readonly issues?: readonly { readonly code: string; readonly message: string }[];
}

function codes(result: Outcome): string[] {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code);
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.evidence-item/v1",
    id: "e1",
    status: "present",
    contentIdentity: hex("a"),
    render: { state: "rendered", originalLength: 100, renderedLength: 100 },
    ...overrides,
  };
}

function bundle(...items: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { schema: "lorelum.judge.evidence-bundle/v1", items };
}

const unavailable = (id: string) => ({
  schema: "lorelum.judge.evidence-item/v1",
  id,
  status: "unavailable",
});

const noEvidence = (id: string) => ({
  schema: "lorelum.judge.evidence-item/v1",
  id,
  status: "no_evidence",
});

describe("evidence item", () => {
  test("accepts a present item that was rendered", () => {
    expect(validateEvidenceBundle(bundle(item())).ok).toBe(true);
  });

  test("accepts no_evidence and unavailable items without content", () => {
    expect(validateEvidenceBundle(bundle(noEvidence("a"), unavailable("b"))).ok).toBe(true);
  });

  test("rejects a present item without a render state", () => {
    const result = validateEvidenceBundle(bundle(item({ render: undefined })));
    expect(codes(result)).toEqual(["evidence_item_invalid"]);
  });

  test("rejects a present item without a content identity", () => {
    const result = validateEvidenceBundle(bundle(item({ contentIdentity: undefined })));
    expect(codes(result)).toEqual(["evidence_item_invalid"]);
  });

  test.each([
    ["contentIdentity", { contentIdentity: hex("b") }],
    ["render", { render: { state: "rendered", originalLength: 1, renderedLength: 1 } }],
    ["conflictsWith", { conflictsWith: ["e2"] }],
  ])("rejects an unavailable item carrying %s", (_name, extra) => {
    const result = validateEvidenceBundle(
      bundle({ ...unavailable("e1"), ...extra }, item({ id: "e2" })),
    );
    expect(codes(result)).toContain("evidence_item_invalid");
  });

  test("rejects a malformed content identity", () => {
    const result = validateEvidenceBundle(bundle(item({ contentIdentity: "sha256:xyz" })));
    expect(codes(result)).toEqual(["schema"]);
  });
});

describe("render lengths", () => {
  const render = (state: string, originalLength: number, renderedLength: number) =>
    bundle(item({ render: { state, originalLength, renderedLength } }));

  test("accepts each state with consistent lengths", () => {
    expect(validateEvidenceBundle(render("rendered", 10, 10)).ok).toBe(true);
    expect(validateEvidenceBundle(render("withheld", 10, 0)).ok).toBe(true);
    expect(validateEvidenceBundle(render("truncated", 10, 4)).ok).toBe(true);
  });

  test.each([
    ["truncated that kept everything", render("truncated", 10, 10)],
    ["truncated that kept more than the original", render("truncated", 10, 12)],
    ["withheld that kept text", render("withheld", 10, 3)],
    ["rendered that lost text", render("rendered", 10, 7)],
  ])("rejects %s", (_name, input) => {
    expect(codes(validateEvidenceBundle(input))).toEqual(["evidence_item_invalid"]);
  });

  test("rejects a negative or fractional length", () => {
    expect(validateEvidenceBundle(render("rendered", -1, -1)).ok).toBe(false);
    expect(validateEvidenceBundle(render("rendered", 1.5, 1.5)).ok).toBe(false);
  });
});

describe("contradiction", () => {
  const contradiction = (id: string, conflictsWith?: readonly string[]) =>
    item({ id, status: "contradiction", conflictsWith });

  test("accepts a contradiction naming another item", () => {
    expect(validateEvidenceBundle(bundle(item({ id: "e1" }), contradiction("e2", ["e1"]))).ok).toBe(
      true,
    );
  });

  test("rejects a contradiction without a counterpart", () => {
    expect(codes(validateEvidenceBundle(bundle(contradiction("e1"))))).toEqual([
      "evidence_item_invalid",
    ]);
    expect(codes(validateEvidenceBundle(bundle(contradiction("e1", []))))).toEqual([
      "evidence_item_invalid",
    ]);
  });

  test("rejects a counterpart that is not in the bundle", () => {
    expect(codes(validateEvidenceBundle(bundle(contradiction("e1", ["missing"]))))).toEqual([
      "evidence_not_in_bundle",
    ]);
  });

  test("rejects a contradiction with itself", () => {
    expect(codes(validateEvidenceBundle(bundle(contradiction("e1", ["e1"]))))).toEqual([
      "evidence_not_in_bundle",
    ]);
  });

  test("rejects conflictsWith on a non-contradiction", () => {
    const result = validateEvidenceBundle(
      bundle(item({ id: "e1", conflictsWith: ["e2"] }), item({ id: "e2" })),
    );
    expect(codes(result)).toEqual(["evidence_item_invalid"]);
  });
});

describe("bundle", () => {
  test("accepts an empty bundle as no evidence collected", () => {
    expect(validateEvidenceBundle(bundle()).ok).toBe(true);
  });

  test("rejects two items with the same id", () => {
    const result = validateEvidenceBundle(bundle(item({ id: "e1" }), unavailable("e1")));
    expect(codes(result)).toEqual(["duplicate_evidence_item"]);
  });

  test("rejects unknown fields and a wrong schema identifier", () => {
    expect(validateEvidenceBundle({ ...bundle(), extra: 1 }).ok).toBe(false);
    expect(
      validateEvidenceBundle({ ...bundle(), schema: "lorelum.judge.evidence-bundle/v2" }).ok,
    ).toBe(false);
  });
});

function criterion(): Record<string, unknown> {
  return {
    schema: "lorelum.judge.criterion/v1",
    id: "c1",
    kind: "contract",
    description: "The endpoint returns the documented status codes",
    mandatory: true,
    source: { origin: "contract", ref: "AC-1" },
    anchors: [
      { verdict: "met", description: "all documented codes returned" },
      { verdict: "unmet", description: "a documented code is missing" },
    ],
    evidence: [
      { evidenceId: "e1", role: "primary" },
      { evidenceId: "e2", role: "reference" },
    ],
  };
}

function verdict(verdictValue: string, evidenceIds: readonly string[]): Record<string, unknown> {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId: "c1",
    verdict: verdictValue,
    evidenceIds,
  };
}

describe("verdict citations", () => {
  test("accepts a decisive verdict resting on rendered evidence", () => {
    const result = validateVerdictEvidence(
      criterion(),
      verdict("met", ["e1"]),
      bundle(item({ id: "e1" })),
    );
    expect(result.ok).toBe(true);
  });

  test("accepts a decisive verdict resting on truncated evidence", () => {
    const truncated = item({
      id: "e1",
      render: { state: "truncated", originalLength: 100, renderedLength: 40 },
    });
    expect(
      validateVerdictEvidence(criterion(), verdict("unmet", ["e1"]), bundle(truncated)).ok,
    ).toBe(true);
  });

  test("one supporting item is enough when others are not supporting", () => {
    const result = validateVerdictEvidence(
      criterion(),
      verdict("met", ["e1", "e2"]),
      bundle(item({ id: "e1" }), unavailable("e2")),
    );
    expect(result.ok).toBe(true);
  });

  test("accepts unknown and insufficient citing nothing", () => {
    expect(validateVerdictEvidence(criterion(), verdict("unknown", []), bundle()).ok).toBe(true);
    expect(validateVerdictEvidence(criterion(), verdict("insufficient", []), bundle()).ok).toBe(
      true,
    );
  });

  test("accepts unknown citing evidence that was not shown", () => {
    const result = validateVerdictEvidence(
      criterion(),
      verdict("unknown", ["e1"]),
      bundle(unavailable("e1")),
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a citation outside the bundle", () => {
    const result = validateVerdictEvidence(criterion(), verdict("unknown", ["e1"]), bundle());
    expect(codes(result)).toEqual(["evidence_not_in_bundle"]);
  });

  const unseen: readonly (readonly [string, Record<string, unknown>])[] = [
    [
      "withheld",
      item({ id: "e1", render: { state: "withheld", originalLength: 10, renderedLength: 0 } }),
    ],
    ["unavailable", unavailable("e1")],
    ["no evidence", noEvidence("e1")],
    ["contradiction", item({ id: "e1", status: "contradiction", conflictsWith: ["e2"] })],
  ];

  test.each(unseen)("rejects a decisive verdict resting only on %s evidence", (_name, cited) => {
    const result = validateVerdictEvidence(
      criterion(),
      verdict("met", ["e1"]),
      bundle(cited, item({ id: "e2" })),
    );
    expect(codes(result)).toEqual(["verdict_unsupported"]);
  });

  test("keeps the criterion rules: a decisive verdict citing nothing fails as before", () => {
    const result = validateVerdictEvidence(criterion(), verdict("met", []), bundle(item()));
    expect(codes(result)).toEqual(["verdict_without_evidence"]);
  });

  test("reports an invalid bundle under the bundle path", () => {
    const result = validateVerdictEvidence(
      criterion(),
      verdict("unknown", []),
      bundle(item({ render: undefined })),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toEqual([
      "$.bundle.items[0]",
    ]);
  });
});

describe("bundle identity", () => {
  const id = (input: unknown): string => {
    const result = evidenceBundleIdentity(input);
    if (!result.ok) {
      throw new Error(`expected an identity: ${JSON.stringify(result.issues)}`);
    }
    return result.identity;
  };

  const first = item({ id: "a" });
  const second = item({ id: "b", contentIdentity: hex("b") });

  test("is well formed", () => {
    expect(id(bundle(first))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("does not depend on item order", () => {
    expect(id(bundle(first, second))).toBe(id(bundle(second, first)));
  });

  test("does not depend on the order of conflictsWith", () => {
    const left = item({ id: "c", status: "contradiction", conflictsWith: ["a", "b"] });
    const right = item({ id: "c", status: "contradiction", conflictsWith: ["b", "a"] });
    expect(id(bundle(first, second, left))).toBe(id(bundle(first, second, right)));
  });

  test.each([
    ["content", item({ id: "a", contentIdentity: hex("c") })],
    [
      "render state",
      item({ id: "a", render: { state: "truncated", originalLength: 100, renderedLength: 40 } }),
    ],
    [
      "rendered length",
      item({ id: "a", render: { state: "truncated", originalLength: 100, renderedLength: 41 } }),
    ],
    ["status", unavailable("a")],
    ["id", item({ id: "z" })],
  ])("changes when the item %s changes", (_name, changed) => {
    expect(id(bundle(changed, second))).not.toBe(id(bundle(first, second)));
  });

  test("a truncation to a different length is a different identity", () => {
    const at = (renderedLength: number) =>
      id(bundle(item({ render: { state: "truncated", originalLength: 100, renderedLength } })));
    expect(at(40)).not.toBe(at(41));
  });

  test("returns issues and no identity for an invalid bundle", () => {
    const result = evidenceBundleIdentity(bundle(item({ render: undefined })));
    expect(codes(result)).toEqual(["evidence_item_invalid"]);
    expect("identity" in result).toBe(false);
  });
});

describe("hostile input", () => {
  const hostile = {
    get schema(): string {
      throw new Error("boom");
    },
  };

  test("a throwing getter yields a failure carrying the cause", () => {
    const outcomes: readonly Outcome[] = [
      validateEvidenceBundle(hostile),
      evidenceBundleIdentity(hostile),
      validateVerdictEvidence(criterion(), verdict("unknown", []), hostile),
      validateVerdictEvidence(hostile, hostile, hostile),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect((outcome.issues ?? []).some((issue) => issue.message.includes("boom"))).toBe(true);
    }
  });

  const inputs: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 1],
    ["string", "x"],
    ["array", []],
  ];

  test.each(inputs)("non-object bundle (%s) is a schema issue", (_name, bad) => {
    expect(codes(validateEvidenceBundle(bad))).toContain("schema");
    expect(codes(evidenceBundleIdentity(bad))).toContain("schema");
  });
});
