import { describe, expect, test } from "bun:test";

import {
  rubricIdentity,
  taskContractIdentity,
  validateCompilationReport,
  validateCriterionDraft,
  validateRubricAgainstContract,
  validateRubricSet,
  validateTaskContract,
} from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

interface Outcome {
  readonly ok: boolean;
  readonly issues?: readonly {
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }[];
}

function codes(result: Outcome): string[] {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code);
}

function paths(result: Outcome): string[] {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.path);
}

function acceptance(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    text: `requirement ${id}`,
    source: { origin: "contract", ref: `AC-${id}` },
    ...overrides,
  };
}

function contract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.task-contract/v1",
    id: "t1",
    taskClass: "cli",
    text: "Add a --json output option",
    acceptance: [acceptance("a1"), acceptance("a2")],
    ...overrides,
  };
}

function criterion(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.criterion/v1",
    id,
    kind: "contract",
    description: `check ${id}`,
    mandatory: true,
    source: { origin: "contract", ref: "AC-1" },
    anchors: [
      { verdict: "met", description: "satisfied" },
      { verdict: "unmet", description: "not satisfied" },
    ],
    evidence: [],
    ...overrides,
  };
}

function entry(id: string, covers: string[], overrides: Record<string, unknown> = {}) {
  return {
    criterion: criterion(id, (overrides.criterion as Record<string, unknown>) ?? {}),
    covers,
    appliesTo: ["cli"],
    role: "decisive",
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "criterion")),
  };
}

function contractId(c: Record<string, unknown> = contract()): string {
  const result = taskContractIdentity(c);
  if (!result.ok) {
    throw new Error(`expected an identity: ${JSON.stringify(result.issues)}`);
  }
  return result.identity;
}

function rubric(
  entries: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: "lorelum.judge.rubric-set/v1",
    id: "r1",
    status: "frozen",
    contractIdentity: contractId(),
    entries,
    ...overrides,
  };
}

const goodEntries = () => [entry("c1", ["a1"]), entry("c2", ["a2"])];

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.compilation-report/v1",
    contractIdentity: contractId(),
    covered: [
      { acceptanceId: "a1", criterionIds: ["c1"] },
      { acceptanceId: "a2", criterionIds: ["c2"] },
    ],
    uncovered: [],
    unsupported: [],
    merged: [],
    ...overrides,
  };
}

describe("task contract", () => {
  test("accepts a contract with sourced acceptance items", () => {
    expect(validateTaskContract(contract()).ok).toBe(true);
  });

  test("rejects a duplicate acceptance id", () => {
    const result = validateTaskContract(
      contract({ acceptance: [acceptance("a1"), acceptance("a1")] }),
    );
    expect(codes(result)).toEqual(["duplicate_acceptance"]);
    expect(paths(result)).toEqual(["$.acceptance[1].id"]);
  });

  test("rejects an acceptance item without a source", () => {
    const result = validateTaskContract(
      contract({ acceptance: [{ id: "a1", text: "no source" }] }),
    );
    expect(codes(result)).toContain("schema");
  });

  test("rejects an acceptance item whose source has an unknown origin", () => {
    const result = validateTaskContract(
      contract({ acceptance: [acceptance("a1", { source: { origin: "guess", ref: "x" } })] }),
    );
    expect(codes(result)).toContain("schema");
  });

  test("rejects the wildcard as a task class", () => {
    expect(codes(validateTaskContract(contract({ taskClass: "*" })))).toEqual([
      "invalid_applicability",
    ]);
  });

  test.each([
    ["no acceptance items", { acceptance: [] }],
    ["an empty task class", { taskClass: "" }],
    ["empty task text", { text: "" }],
    ["an unknown field", { extra: 1 }],
    ["a wrong schema identifier", { schema: "lorelum.judge.task-contract/v2" }],
  ])("rejects %s", (_name, overrides) => {
    expect(validateTaskContract(contract(overrides)).ok).toBe(false);
  });
});

describe("rubric set on its own", () => {
  test("accepts a frozen rubric with complete criteria", () => {
    expect(validateRubricSet(rubric(goodEntries())).ok).toBe(true);
  });

  test("accepts a proposal whose criterion has no anchors", () => {
    const draft = entry("c1", ["a1"], { criterion: { anchors: [] } });
    expect(validateRubricSet(rubric([draft], { status: "proposal" })).ok).toBe(true);
  });

  test("rejects the same rubric as frozen", () => {
    const draft = entry("c1", ["a1"], { criterion: { anchors: [] } });
    const result = validateRubricSet(rubric([draft], { status: "frozen" }));
    expect(codes(result)).toContain("anchor_mismatch");
    expect(paths(result)[0]).toBe("$.entries[0].criterion.anchors");
  });

  test.each(["proposal", "frozen"])(
    "rejects a mandatory criterion without a source in %s",
    (status) => {
      const noSource = entry("c1", ["a1"], { criterion: { source: undefined } });
      const result = validateRubricSet(rubric([noSource], { status }));
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("schema");
    },
  );

  test("a frozen rubric rejects two primary owners of one evidence id", () => {
    const evidence = [{ evidenceId: "e1", role: "primary" }];
    const result = validateRubricSet(
      rubric([
        entry("c1", ["a1"], { criterion: { evidence } }),
        entry("c2", ["a2"], { criterion: { evidence } }),
      ]),
    );
    expect(codes(result)).toContain("duplicate_primary_evidence");
  });

  test("a proposal does not check primary ownership", () => {
    const evidence = [{ evidenceId: "e1", role: "primary" }];
    const result = validateRubricSet(
      rubric(
        [
          entry("c1", ["a1"], { criterion: { evidence } }),
          entry("c2", ["a2"], { criterion: { evidence } }),
        ],
        { status: "proposal" },
      ),
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a duplicate criterion id in both states", () => {
    for (const status of ["proposal", "frozen"]) {
      const result = validateRubricSet(
        rubric([entry("c1", ["a1"]), entry("c1", ["a2"])], { status }),
      );
      expect(codes(result)).toContain("duplicate_criterion");
    }
  });

  test("rejects the wildcard mixed with a class", () => {
    const mixed = entry("c1", ["a1"], { appliesTo: ["*", "cli"] });
    expect(codes(validateRubricSet(rubric([mixed])))).toEqual(["invalid_applicability"]);
  });

  test("accepts the wildcard alone", () => {
    expect(validateRubricSet(rubric([entry("c1", ["a1"], { appliesTo: ["*"] })])).ok).toBe(true);
  });

  test.each([
    ["no entries", { entries: [] }],
    ["an unknown status", { status: "draft" }],
    ["a malformed contract identity", { contractIdentity: "sha256:xyz" }],
    ["an unknown field", { extra: 1 }],
  ])("rejects %s", (_name, overrides) => {
    expect(validateRubricSet(rubric(goodEntries(), overrides)).ok).toBe(false);
  });

  test.each([
    ["empty covers", { covers: [] }],
    ["duplicate covers", { covers: ["a1", "a1"] }],
    ["empty appliesTo", { appliesTo: [] }],
    ["duplicate appliesTo", { appliesTo: ["cli", "cli"] }],
    ["an unknown role", { role: "required" }],
  ])("rejects an entry with %s", (_name, overrides) => {
    expect(validateRubricSet(rubric([entry("c1", ["a1"], overrides)])).ok).toBe(false);
  });
});

describe("rubric against its contract", () => {
  test("accepts a matching rubric", () => {
    expect(validateRubricAgainstContract(rubric(goodEntries()), contract()).ok).toBe(true);
  });

  test("rejects a rubric written for another contract", () => {
    const other = contract({ id: "t2" });
    expect(codes(validateRubricAgainstContract(rubric(goodEntries()), other))).toEqual([
      "identity_mismatch",
    ]);
  });

  test("rejects an entry covering an acceptance id the contract lacks", () => {
    const result = validateRubricAgainstContract(rubric([entry("c1", ["a1", "zz"])]), contract());
    expect(codes(result)).toEqual(["unknown_acceptance"]);
    expect(paths(result)).toEqual(["$.entries[0].covers[1]"]);
  });

  test("rejects a domain entry that does not apply to the task class", () => {
    const web = entry("c1", ["a1"], { appliesTo: ["web"] });
    const result = validateRubricAgainstContract(rubric([web]), contract({ taskClass: "cli" }));
    expect(codes(result)).toEqual(["not_applicable"]);
  });

  test("a wildcard entry applies to every class", () => {
    const any = entry("c1", ["a1"], { appliesTo: ["*"] });
    for (const taskClass of ["cli", "web", "data-pipeline"]) {
      const c = contract({ taskClass });
      const r = rubric([any], { contractIdentity: contractId(c) });
      expect(validateRubricAgainstContract(r, c).ok).toBe(true);
    }
  });

  test("an entry listing several classes applies if one matches", () => {
    const multi = entry("c1", ["a1"], { appliesTo: ["web", "cli"] });
    expect(validateRubricAgainstContract(rubric([multi]), contract()).ok).toBe(true);
  });

  test("an invalid contract is reported under the contract path", () => {
    const result = validateRubricAgainstContract(
      rubric(goodEntries()),
      contract({ acceptance: [] }),
    );
    expect(result.ok).toBe(false);
    expect(paths(result).every((path) => path.startsWith("$.contract"))).toBe(true);
  });
});

describe("compilation report", () => {
  const check = (r: Record<string, unknown>, entries = goodEntries()) =>
    validateCompilationReport(r, rubric(entries), contract());

  test("accepts a report that agrees with the rubric", () => {
    expect(check(report()).ok).toBe(true);
  });

  test("accepts uncovered and unsupported items with reasons", () => {
    const r = report({
      covered: [{ acceptanceId: "a1", criterionIds: ["c1"] }],
      uncovered: [{ acceptanceId: "a2", reason: "no rule yet" }],
    });
    expect(check(r, [entry("c1", ["a1"])]).ok).toBe(true);
    const u = report({
      covered: [{ acceptanceId: "a1", criterionIds: ["c1"] }],
      unsupported: [{ acceptanceId: "a2", reason: "needs a browser" }],
    });
    expect(check(u, [entry("c1", ["a1"])]).ok).toBe(true);
  });

  test("rejects coverage nothing provides", () => {
    const r = report({
      covered: [
        { acceptanceId: "a1", criterionIds: ["c1"] },
        { acceptanceId: "a2", criterionIds: ["c9"] },
      ],
    });
    const result = check(r, [entry("c1", ["a1"])]);
    expect(codes(result)).toEqual(["report_mismatch"]);
    expect(paths(result)).toEqual(["$.covered[1]"]);
  });

  test("rejects an acceptance id missing from all lists", () => {
    const r = report({ covered: [{ acceptanceId: "a1", criterionIds: ["c1"] }] });
    const result = check(r);
    expect(codes(result)).toEqual(["report_mismatch"]);
    expect(result.ok ? "" : result.issues?.[0]?.message).toContain('"a2"');
  });

  test("rejects an acceptance id in two lists", () => {
    const r = report({ uncovered: [{ acceptanceId: "a1", reason: "x" }] });
    const result = check(r);
    expect(codes(result)).toContain("report_mismatch");
  });

  test("rejects a gap for an item an entry covers", () => {
    const r = report({
      covered: [{ acceptanceId: "a2", criterionIds: ["c2"] }],
      uncovered: [{ acceptanceId: "a1", reason: "claimed uncovered" }],
    });
    expect(codes(check(r))).toEqual(["report_mismatch"]);
  });

  test("rejects covered with the wrong criterion ids", () => {
    const r = report({
      covered: [
        { acceptanceId: "a1", criterionIds: ["c2"] },
        { acceptanceId: "a2", criterionIds: ["c2"] },
      ],
    });
    const result = check(r);
    expect(codes(result)).toEqual(["report_mismatch"]);
    expect(paths(result)).toEqual(["$.covered[0].criterionIds"]);
  });

  test("accepts covered with several criteria in any order", () => {
    const entries = [entry("c1", ["a1"]), entry("c3", ["a1"]), entry("c2", ["a2"])];
    const r = report({
      covered: [
        { acceptanceId: "a1", criterionIds: ["c3", "c1"] },
        { acceptanceId: "a2", criterionIds: ["c2"] },
      ],
    });
    expect(check(r, entries).ok).toBe(true);
  });

  test("rejects an acceptance id the contract does not have", () => {
    const r = report({
      covered: [
        { acceptanceId: "a1", criterionIds: ["c1"] },
        { acceptanceId: "a2", criterionIds: ["c2"] },
        { acceptanceId: "zz", criterionIds: ["c1"] },
      ],
    });
    expect(codes(check(r))).toEqual(["unknown_acceptance"]);
  });

  test("rejects a gap without a reason", () => {
    const r = report({
      covered: [{ acceptanceId: "a1", criterionIds: ["c1"] }],
      uncovered: [{ acceptanceId: "a2", reason: "" }],
    });
    expect(check(r, [entry("c1", ["a1"])]).ok).toBe(false);
  });

  test("merged records name a surviving criterion and absorbed ids", () => {
    expect(check(report({ merged: [{ criterionId: "c1", mergedFrom: ["c7"] }] })).ok).toBe(true);
  });

  test("rejects a merge into a criterion the rubric lacks", () => {
    const result = check(report({ merged: [{ criterionId: "c9", mergedFrom: ["c7"] }] }));
    expect(codes(result)).toEqual(["report_mismatch"]);
    expect(paths(result)).toEqual(["$.merged[0].criterionId"]);
  });

  test("rejects a merged-away id that is still in the rubric", () => {
    const result = check(report({ merged: [{ criterionId: "c1", mergedFrom: ["c2"] }] }));
    expect(codes(result)).toEqual(["report_mismatch"]);
    expect(paths(result)).toEqual(["$.merged[0].mergedFrom[0]"]);
  });

  test("rejects a report for another contract", () => {
    const result = check(report({ contractIdentity: hex("f") }));
    expect(codes(result)).toEqual(["identity_mismatch"]);
  });

  test("an invalid rubric is reported under the rubric path", () => {
    const result = validateCompilationReport(report(), rubric([]), contract());
    expect(result.ok).toBe(false);
    expect(paths(result).every((path) => path.startsWith("$.rubric"))).toBe(true);
  });
});

function instrument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.instrument-profile/v1",
    model: { provider: "p", name: "m" },
    decoding: { temperature: 0 },
    promptIdentity: hex("1"),
    runtime: { name: "r", version: "1" },
    repetitions: 1,
    ...overrides,
  };
}

function binding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract: contract(),
    contextIdentity: hex("2"),
    instrument: instrument(),
    policyIdentity: hex("3"),
    ...overrides,
  };
}

describe("contract identity", () => {
  test("does not depend on acceptance order", () => {
    const forward = contractId(contract({ acceptance: [acceptance("a1"), acceptance("a2")] }));
    const reverse = contractId(contract({ acceptance: [acceptance("a2"), acceptance("a1")] }));
    expect(reverse).toBe(forward);
  });

  test.each([
    ["task class", { taskClass: "web" }],
    ["task text", { text: "something else" }],
    [
      "an acceptance text",
      { acceptance: [acceptance("a1", { text: "changed" }), acceptance("a2")] },
    ],
    [
      "an acceptance source",
      {
        acceptance: [acceptance("a1", { source: { origin: "user", ref: "x" } }), acceptance("a2")],
      },
    ],
    ["an acceptance id", { acceptance: [acceptance("a1"), acceptance("a3")] }],
  ])("changes when the %s changes", (_name, overrides) => {
    expect(contractId(contract(overrides))).not.toBe(contractId());
  });

  test("returns issues and no identity for an invalid contract", () => {
    const result = taskContractIdentity(contract({ acceptance: [] }));
    expect(result.ok).toBe(false);
    expect("identity" in result).toBe(false);
  });
});

describe("rubric identity", () => {
  const id = (r: Record<string, unknown>, b: Record<string, unknown> = binding()): string => {
    const result = rubricIdentity(r, b);
    if (!result.ok) {
      throw new Error(`expected an identity: ${JSON.stringify(result.issues)}`);
    }
    return result.identity;
  };

  test("is well formed", () => {
    expect(id(rubric(goodEntries()))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("does not depend on entry order", () => {
    expect(id(rubric(goodEntries()))).toBe(id(rubric([...goodEntries()].reverse())));
  });

  test("does not depend on the order inside covers and appliesTo", () => {
    const a = rubric([entry("c1", ["a1", "a2"], { appliesTo: ["cli", "web"] })]);
    const b = rubric([entry("c1", ["a2", "a1"], { appliesTo: ["web", "cli"] })]);
    expect(id(a)).toBe(id(b));
  });

  test("changes with the rubric status", () => {
    expect(id(rubric(goodEntries(), { status: "proposal" }))).not.toBe(id(rubric(goodEntries())));
  });

  test("changes with a criterion's content", () => {
    const changed = [
      entry("c1", ["a1"], { criterion: { description: "different" } }),
      entry("c2", ["a2"]),
    ];
    expect(id(rubric(changed))).not.toBe(id(rubric(goodEntries())));
  });

  test("changes with an entry's role", () => {
    const changed = [entry("c1", ["a1"], { role: "advisory" }), entry("c2", ["a2"])];
    expect(id(rubric(changed))).not.toBe(id(rubric(goodEntries())));
  });

  test("changes with what an entry covers", () => {
    const changed = [entry("c1", ["a2"]), entry("c2", ["a2"])];
    expect(id(rubric(changed))).not.toBe(id(rubric(goodEntries())));
  });

  const base = id(rubric(goodEntries()));

  test("changes with the context identity", () => {
    expect(id(rubric(goodEntries()), binding({ contextIdentity: hex("9") }))).not.toBe(base);
  });

  test("changes with the policy identity", () => {
    expect(id(rubric(goodEntries()), binding({ policyIdentity: hex("9") }))).not.toBe(base);
  });

  test("changes with the instrument's model", () => {
    const changed = instrument({ model: { provider: "p", name: "other" } });
    expect(id(rubric(goodEntries()), binding({ instrument: changed }))).not.toBe(base);
  });

  test("changes with the instrument's prompt identity", () => {
    const changed = instrument({ promptIdentity: hex("9") });
    expect(id(rubric(goodEntries()), binding({ instrument: changed }))).not.toBe(base);
  });

  test("changes with the instrument's decoding", () => {
    const changed = instrument({ decoding: { temperature: 0.5 } });
    expect(id(rubric(goodEntries()), binding({ instrument: changed }))).not.toBe(base);
  });

  test("changes with the contract", () => {
    const other = contract({ text: "different task" });
    const r = rubric(goodEntries(), { contractIdentity: contractId(other) });
    expect(id(r, binding({ contract: other }))).not.toBe(base);
  });

  test("rejects a rubric that does not match the bound contract", () => {
    const result = rubricIdentity(
      rubric(goodEntries()),
      binding({ contract: contract({ id: "t2" }) }),
    );
    expect(codes(result)).toEqual(["identity_mismatch"]);
  });

  test.each([
    ["a missing context identity", { contextIdentity: undefined }],
    ["a malformed context identity", { contextIdentity: "nope" }],
    ["a missing policy identity", { policyIdentity: undefined }],
    ["a malformed policy identity", { policyIdentity: "sha256:xyz" }],
  ])("rejects %s", (_name, overrides) => {
    const result = rubricIdentity(rubric(goodEntries()), binding(overrides));
    expect(result.ok).toBe(false);
    expect(paths(result)[0]).toMatch(/^\$\.binding\./);
  });

  test("rejects an invalid instrument under the binding path", () => {
    const result = rubricIdentity(rubric(goodEntries()), binding({ instrument: { schema: "x" } }));
    expect(result.ok).toBe(false);
    expect(paths(result).every((path) => path.startsWith("$.binding.instrument"))).toBe(true);
  });

  test("rejects a binding that is not an object", () => {
    expect(codes(rubricIdentity(rubric(goodEntries()), null))).toEqual(["schema"]);
  });
});

describe("non-object input", () => {
  const inputs: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 1],
    ["string", "x"],
    ["array", []],
  ];

  test.each(inputs)("%s is a schema issue from every validator", (_name, bad) => {
    for (const outcome of [
      validateTaskContract(bad),
      validateRubricSet(bad),
      taskContractIdentity(bad),
    ]) {
      expect(codes(outcome)).toContain("schema");
    }
    expect(validateRubricAgainstContract(bad, bad).ok).toBe(false);
    expect(validateCompilationReport(bad, bad, bad).ok).toBe(false);
    expect(rubricIdentity(bad, bad).ok).toBe(false);
  });
});

describe("hostile input", () => {
  const hostile = {
    get schema(): string {
      throw new Error("boom");
    },
  };

  // The getter sits on a field the binding check reads, so the cause must be reported.
  const hostileBinding = {
    get contextIdentity(): string {
      throw new Error("boom");
    },
    policyIdentity: hex("3"),
  };

  test("a throwing getter yields a failure carrying the cause", () => {
    const outcomes: readonly Outcome[] = [
      validateTaskContract(hostile),
      validateRubricSet(hostile),
      taskContractIdentity(hostile),
      validateRubricAgainstContract(hostile, contract()),
      validateRubricAgainstContract(rubric(goodEntries()), hostile),
      validateCompilationReport(hostile, rubric(goodEntries()), contract()),
      validateCompilationReport(report(), hostile, contract()),
      validateCompilationReport(report(), rubric(goodEntries()), hostile),
      rubricIdentity(hostile, binding()),
      rubricIdentity(rubric(goodEntries()), hostileBinding),
      rubricIdentity(rubric(goodEntries()), binding({ instrument: hostile })),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect((outcome.issues ?? []).some((issue) => issue.message.includes("boom"))).toBe(true);
    }
  });
});

describe("input is read once into a snapshot", () => {
  test("a contract that inherits its fields is rejected, not hashed without them", () => {
    const inherited = (taskClass: string, text: string) =>
      Object.create({ ...contract(), taskClass, text });
    const one = taskContractIdentity(inherited("cli", "one"));
    const two = taskContractIdentity(inherited("web", "two"));
    expect(one.ok).toBe(false);
    expect(two.ok).toBe(false);
  });

  test("a getter is read exactly once, and the identity covers what was read", () => {
    let reads = 0;
    const stateful = {
      ...contract(),
      get text(): string {
        reads += 1;
        return reads === 1 ? "first" : "later";
      },
    };
    const identity = taskContractIdentity(stateful);
    expect(reads).toBe(1);
    expect(identity.ok).toBe(true);
    expect(identity.ok ? identity.identity : "").toBe(contractId(contract({ text: "first" })));
  });

  test("a rubric is validated against the same contract that is hashed", () => {
    let reads = 0;
    const flipping = {
      get contract(): unknown {
        reads += 1;
        return reads === 1 ? contract() : contract({ id: "other" });
      },
      contextIdentity: hex("2"),
      instrument: instrument(),
      policyIdentity: hex("3"),
    };
    const result = rubricIdentity(rubric(goodEntries()), flipping);
    // The contract is read at most once, so a flip cannot bind the identity to a
    // contract the rubric was not validated against.
    expect(reads).toBeLessThanOrEqual(1);
    if (result.ok) {
      const direct = rubricIdentity(rubric(goodEntries()), binding());
      expect(direct.ok ? direct.identity : "").toBe(result.identity);
    }
  });

  test.each([
    [
      "a circular reference",
      () => {
        const loop: Record<string, unknown> = { ...contract() };
        loop.self = loop;
        return loop;
      },
    ],
    ["a bigint field", () => ({ ...contract(), count: 1n })],
    [
      "a toJSON that throws",
      () => ({
        ...contract(),
        toJSON(): never {
          throw new Error("boom");
        },
      }),
    ],
  ])("%s is a structured failure", (_name, build) => {
    const result = validateTaskContract(build());
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["schema"]);
  });
});

describe("proposal rules", () => {
  const proposal = (criterionOverrides: Record<string, unknown>) =>
    validateRubricSet(
      rubric([entry("c1", ["a1"], { criterion: criterionOverrides })], { status: "proposal" }),
    );

  test("a proposal may leave anchors out", () => {
    expect(proposal({ anchors: [] }).ok).toBe(true);
  });

  test("a proposal may have only some anchors", () => {
    expect(proposal({ anchors: [{ verdict: "met", description: "ok" }] }).ok).toBe(true);
  });

  test("a proposal still rejects an anchor the kind does not allow", () => {
    const result = proposal({ anchors: [{ verdict: "strong", description: "wrong kind" }] });
    expect(codes(result)).toEqual(["anchor_mismatch"]);
  });

  test("a proposal still rejects a repeated anchor", () => {
    const result = proposal({
      anchors: [
        { verdict: "met", description: "a" },
        { verdict: "met", description: "b" },
      ],
    });
    expect(codes(result)).toEqual(["anchor_mismatch"]);
  });

  test("a proposal still rejects a duplicate evidence selector", () => {
    const result = proposal({
      evidence: [
        { evidenceId: "e1", role: "primary" },
        { evidenceId: "e1", role: "reference" },
      ],
    });
    expect(codes(result)).toEqual(["duplicate_evidence"]);
  });

  test("validateCriterionDraft is lenient only about missing anchors", () => {
    expect(validateCriterionDraft(criterion("c1", { anchors: [] })).ok).toBe(true);
    expect(validateCriterionDraft(criterion("c1", { source: undefined })).ok).toBe(false);
    expect(
      validateCriterionDraft(
        criterion("c1", { anchors: [{ verdict: "strong", description: "x" }] }),
      ).ok,
    ).toBe(false);
  });

  test("a duplicate criterion id is reported once in each state", () => {
    for (const status of ["proposal", "frozen"]) {
      const result = validateRubricSet(
        rubric([entry("c1", ["a1"]), entry("c1", ["a2"])], { status }),
      );
      expect(codes(result).filter((code) => code === "duplicate_criterion")).toHaveLength(1);
    }
  });
});

describe("report: exactly one list, and merged coherence", () => {
  const check = (r: Record<string, unknown>, entries = goodEntries()) =>
    validateCompilationReport(r, rubric(entries), contract());
  const onlyA1 = [entry("c1", ["a1"])];
  const covered1 = { acceptanceId: "a1", criterionIds: ["c1"] };

  test("an id covered twice is rejected", () => {
    const result = check(report({ covered: [covered1, covered1] }), onlyA1);
    expect(codes(result)).toContain("report_mismatch");
  });

  test("an id in uncovered and unsupported is rejected", () => {
    const r = report({
      covered: [covered1],
      uncovered: [{ acceptanceId: "a2", reason: "x" }],
      unsupported: [{ acceptanceId: "a2", reason: "y" }],
    });
    expect(codes(check(r, onlyA1))).toEqual(["report_mismatch"]);
  });

  test("an id listed twice in uncovered is rejected", () => {
    const r = report({
      covered: [covered1],
      uncovered: [
        { acceptanceId: "a2", reason: "x" },
        { acceptanceId: "a2", reason: "y" },
      ],
    });
    expect(codes(check(r, onlyA1))).toEqual(["report_mismatch"]);
  });

  test.each(["uncovered", "unsupported"])("an unknown id in %s is rejected", (list) => {
    const r = report({
      covered: [covered1],
      uncovered: [{ acceptanceId: "a2", reason: "x" }],
      [list]: [{ acceptanceId: "zz", reason: "y" }],
    });
    expect(codes(check(r, onlyA1))).toContain("unknown_acceptance");
  });

  test("covered naming a criterion that is not in the rubric is rejected", () => {
    const r = report({
      covered: [
        { acceptanceId: "a1", criterionIds: ["c1"] },
        { acceptanceId: "a2", criterionIds: ["nope"] },
      ],
    });
    expect(codes(check(r))).toEqual(["report_mismatch"]);
  });

  test("a whitespace-only reason is rejected", () => {
    const r = report({
      covered: [covered1],
      uncovered: [{ acceptanceId: "a2", reason: "   " }],
    });
    expect(check(r, onlyA1).ok).toBe(false);
  });

  test("a survivor with two merged records is rejected", () => {
    const r = report({
      merged: [
        { criterionId: "c1", mergedFrom: ["c7"] },
        { criterionId: "c1", mergedFrom: ["c8"] },
      ],
    });
    expect(codes(check(r))).toEqual(["report_mismatch"]);
  });

  test("an absorbed id merged into two survivors is rejected", () => {
    const r = report({
      merged: [
        { criterionId: "c1", mergedFrom: ["c7"] },
        { criterionId: "c2", mergedFrom: ["c7"] },
      ],
    });
    expect(codes(check(r))).toEqual(["report_mismatch"]);
  });

  test("two survivors absorbing different ids is accepted", () => {
    const r = report({
      merged: [
        { criterionId: "c1", mergedFrom: ["c7"] },
        { criterionId: "c2", mergedFrom: ["c8"] },
      ],
    });
    expect(check(r).ok).toBe(true);
  });
});

describe("rubric identity: remaining fields", () => {
  const id = (r: Record<string, unknown>): string => {
    const result = rubricIdentity(r, binding());
    if (!result.ok) {
      throw new Error(`expected an identity: ${JSON.stringify(result.issues)}`);
    }
    return result.identity;
  };
  const base = id(rubric(goodEntries()));

  test("changes with an entry's appliesTo content", () => {
    const changed = [entry("c1", ["a1"], { appliesTo: ["cli", "web"] }), entry("c2", ["a2"])];
    expect(id(rubric(changed))).not.toBe(base);
  });

  test("changes with the rubric id", () => {
    expect(id(rubric(goodEntries(), { id: "r2" }))).not.toBe(base);
  });
});

describe("applicability edge cases", () => {
  test("a contract class of * is rejected, so no rubric can be checked against it", () => {
    const wildcardContract = contract({ taskClass: "*" });
    const r = rubric([entry("c1", ["a1"], { appliesTo: ["*"] })], {
      contractIdentity: hex("a"),
    });
    expect(validateRubricAgainstContract(r, wildcardContract).ok).toBe(false);
  });

  test("class names are matched exactly, including case", () => {
    const upper = entry("c1", ["a1"], { appliesTo: ["CLI"] });
    expect(codes(validateRubricAgainstContract(rubric([upper]), contract()))).toEqual([
      "not_applicable",
    ]);
  });
});
