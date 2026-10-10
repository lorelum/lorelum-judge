import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../src/index.js";
import {
  definitionIdentity,
  evaluateEnforcement,
  gatePolicyIdentity,
  identityOf,
  instrumentIdentity,
  measurementKey,
  validateCalibration,
  validateDefinition,
  validateGatePolicy,
  validateInstrument,
  validateRun,
} from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

function criterion(id: string, evidenceId: string): Record<string, unknown> {
  return {
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
  };
}

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.measurement-definition/v1",
    id: "m1",
    criteria: [criterion("c1", "e1"), criterion("c2", "e2")],
    ...overrides,
  };
}

function instrument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.instrument-profile/v1",
    model: { provider: "p", name: "m", version: "1" },
    decoding: { temperature: 0, topP: 1, maxTokens: 1024, seed: 7 },
    promptIdentity: hex("a"),
    runtime: { name: "r", version: "1.0.0" },
    repetitions: 3,
    ...overrides,
  };
}

function gatePolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.gate-policy/v1",
    id: "g1",
    onUncalibrated: "shadow",
    ...overrides,
  };
}

function id(outcome: { ok: boolean; identity?: string; issues?: unknown }): string {
  if (!outcome.ok || outcome.identity === undefined) {
    throw new Error(`expected an identity: ${JSON.stringify(outcome.issues)}`);
  }
  return outcome.identity;
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.measurement-run/v1",
    id: "r1",
    definitionIdentity: id(definitionIdentity(definition())),
    instrumentIdentity: id(instrumentIdentity(instrument())),
    instrumentSource: "declared",
    verdicts: [
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c1",
        verdict: "met",
        evidenceIds: ["e1"],
      },
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c2",
        verdict: "unmet",
        evidenceIds: ["e2"],
      },
    ],
    ...overrides,
  };
}

function calibration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "lorelum.judge.calibration-artifact/v1",
    id: "k1",
    definitionIdentity: id(definitionIdentity(definition())),
    instrumentIdentity: id(instrumentIdentity(instrument())),
    gatePolicyIdentity: id(gatePolicyIdentity(gatePolicy())),
    status: "enforced",
    ...overrides,
  };
}

function codes(result: { ok: boolean; issues?: readonly { code: string }[] }): string[] {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code);
}

describe("identity compatibility", () => {
  test("an identity computed before the measurement contracts existed is unchanged", () => {
    const earlier = {
      schema: "lorelum.judge.criterion/v1",
      id: "c1",
      kind: "contract",
      description: "The endpoint returns the documented status codes",
      mandatory: true,
      source: { origin: "contract", ref: "AC-1" },
      anchors: [
        { verdict: "met", description: "all documented codes are returned" },
        { verdict: "unmet", description: "a documented code is missing or wrong" },
      ],
      evidence: [{ evidenceId: "e1", role: "primary" }],
    };
    const result = identityOf("lorelum.judge.criterion/v1", earlier as JsonValue);
    expect(result).toEqual({
      ok: true,
      identity: "sha256:e7d94e717fff8f20dd83cea4702901ddf83757a497a6693cdd6a4886efdcba77",
    });
  });
});

describe("definition identity", () => {
  test("is stable for equal content and well formed", () => {
    expect(id(definitionIdentity(definition()))).toBe(id(definitionIdentity(definition())));
    expect(id(definitionIdentity(definition()))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test.each([
    ["criterion description", (c: Record<string, unknown>) => ({ ...c, description: "changed" })],
    [
      "anchor description",
      (c: Record<string, unknown>) => ({
        ...c,
        anchors: [
          { verdict: "met", description: "changed" },
          { verdict: "unmet", description: "not satisfied" },
        ],
      }),
    ],
    ["mandatory flag", (c: Record<string, unknown>) => ({ ...c, mandatory: false })],
    [
      "evidence selector",
      (c: Record<string, unknown>) => ({
        ...c,
        evidence: [{ evidenceId: "e1", role: "reference" }],
      }),
    ],
  ])("changes when the %s changes", (_name, change) => {
    const base = id(definitionIdentity(definition()));
    const changed = definition({
      criteria: [change(criterion("c1", "e1")), criterion("c2", "e2")],
    });
    expect(id(definitionIdentity(changed))).not.toBe(base);
  });

  test("changes when a criterion is added, removed, or reordered", () => {
    const base = id(definitionIdentity(definition()));
    expect(
      id(
        definitionIdentity(
          definition({
            criteria: [criterion("c1", "e1"), criterion("c2", "e2"), criterion("c3", "e3")],
          }),
        ),
      ),
    ).not.toBe(base);
    expect(id(definitionIdentity(definition({ criteria: [criterion("c1", "e1")] })))).not.toBe(
      base,
    );
    expect(
      id(
        definitionIdentity(
          definition({ criteria: [criterion("c2", "e2"), criterion("c1", "e1")] }),
        ),
      ),
    ).not.toBe(base);
  });

  test("a definition with no criteria yields issues and no identity", () => {
    const result = definitionIdentity(definition({ criteria: [] }));
    expect(result.ok).toBe(false);
    expect("identity" in result).toBe(false);
  });

  test("criterion-set rules apply inside a definition and report under $.criteria", () => {
    const duplicatePrimary = definition({
      criteria: [criterion("c1", "e1"), criterion("c2", "e1")],
    });
    const result = validateDefinition(duplicatePrimary);
    expect(codes(result)).toEqual(["duplicate_primary_evidence"]);
    if (!result.ok) {
      expect(result.issues[0]?.path.startsWith("$.criteria[1]")).toBe(true);
    }
  });
});

describe("instrument identity", () => {
  test.each([
    ["model provider", { model: { provider: "q", name: "m", version: "1" } }],
    ["model name", { model: { provider: "p", name: "n", version: "1" } }],
    ["model version", { model: { provider: "p", name: "m", version: "2" } }],
    ["temperature", { decoding: { temperature: 0.5, topP: 1, maxTokens: 1024, seed: 7 } }],
    ["topP", { decoding: { temperature: 0, topP: 0.9, maxTokens: 1024, seed: 7 } }],
    ["maxTokens", { decoding: { temperature: 0, topP: 1, maxTokens: 2048, seed: 7 } }],
    ["seed", { decoding: { temperature: 0, topP: 1, maxTokens: 1024, seed: 8 } }],
    ["prompt identity", { promptIdentity: hex("b") }],
    ["runtime name", { runtime: { name: "s", version: "1.0.0" } }],
    ["runtime version", { runtime: { name: "r", version: "2.0.0" } }],
    ["repetitions", { repetitions: 4 }],
  ])("changes when the %s changes", (_name, overrides) => {
    expect(id(instrumentIdentity(instrument(overrides)))).not.toBe(
      id(instrumentIdentity(instrument())),
    );
  });

  test("distinguishes an absent decoding parameter from a present one", () => {
    expect(id(instrumentIdentity(instrument({ decoding: {} })))).not.toBe(
      id(instrumentIdentity(instrument({ decoding: { seed: 0 } }))),
    );
  });

  test("equal instruments have equal identities regardless of key order", () => {
    const reordered = {
      repetitions: 3,
      runtime: { version: "1.0.0", name: "r" },
      promptIdentity: hex("a"),
      decoding: { seed: 7, maxTokens: 1024, topP: 1, temperature: 0 },
      model: { version: "1", name: "m", provider: "p" },
      schema: "lorelum.judge.instrument-profile/v1",
    };
    expect(id(instrumentIdentity(reordered))).toBe(id(instrumentIdentity(instrument())));
  });

  test.each([
    ["prompt identity not a sha256", { promptIdentity: "abc" }],
    ["uppercase prompt identity", { promptIdentity: `sha256:${"A".repeat(64)}` }],
    ["seed above the safe integer limit", { decoding: { seed: 9007199254740992 } }],
    ["maxTokens above the safe integer limit", { decoding: { maxTokens: 9007199254740992 } }],
    ["repetitions above the safe integer limit", { repetitions: 9007199254740992 }],
    ["zero repetitions", { repetitions: 0 }],
    ["fractional repetitions", { repetitions: 1.5 }],
    ["negative temperature", { decoding: { temperature: -1 } }],
    ["topP above one", { decoding: { topP: 2 } }],
    ["missing runtime", { runtime: undefined }],
  ])("rejects %s and yields no identity", (_name, overrides) => {
    const result = instrumentIdentity(instrument(overrides));
    expect(result.ok).toBe(false);
    expect("identity" in result).toBe(false);
  });
});

describe("instrument source", () => {
  test("a run with any source other than declared is rejected", () => {
    expect(validateRun(definition(), instrument(), run({ instrumentSource: "verified" })).ok).toBe(
      false,
    );
  });

  test("a declared run is accepted", () => {
    expect(validateRun(definition(), instrument(), run()).ok).toBe(true);
  });
});

describe("run coverage", () => {
  test("rejects a criterion with no verdict instead of treating it as a failure", () => {
    const onlyFirst = [
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c1",
        verdict: "met",
        evidenceIds: ["e1"],
      },
    ];
    const result = validateRun(definition(), instrument(), run({ verdicts: onlyFirst }));
    expect(codes(result)).toEqual(["missing_verdict"]);
  });

  test("rejects two verdicts for one criterion", () => {
    const verdicts = [
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c1",
        verdict: "met",
        evidenceIds: ["e1"],
      },
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c1",
        verdict: "unmet",
        evidenceIds: ["e1"],
      },
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c2",
        verdict: "met",
        evidenceIds: ["e2"],
      },
    ];
    expect(codes(validateRun(definition(), instrument(), run({ verdicts })))).toEqual([
      "duplicate_verdict",
    ]);
  });

  test("rejects a verdict for a criterion the definition does not have", () => {
    const verdicts = [
      ...(run().verdicts as unknown[]),
      { schema: "lorelum.judge.verdict/v1", criterionId: "zzz", verdict: "met", evidenceIds: [] },
    ];
    expect(codes(validateRun(definition(), instrument(), run({ verdicts })))).toEqual([
      "unknown_criterion",
    ]);
  });

  test("accepts unknown and insufficient verdicts without evidence", () => {
    const verdicts = [
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c1",
        verdict: "unknown",
        evidenceIds: [],
      },
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c2",
        verdict: "insufficient",
        evidenceIds: [],
      },
    ];
    expect(validateRun(definition(), instrument(), run({ verdicts })).ok).toBe(true);
  });

  test("a decisive verdict without evidence is rejected under its own path", () => {
    const verdicts = [
      { schema: "lorelum.judge.verdict/v1", criterionId: "c1", verdict: "unmet", evidenceIds: [] },
      (run().verdicts as unknown[])[1],
    ];
    const result = validateRun(definition(), instrument(), run({ verdicts }));
    expect(codes(result)).toEqual(["verdict_without_evidence"]);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("$.verdicts[0].evidenceIds");
    }
  });

  test("rejects a run bound to a different definition or instrument", () => {
    const otherDefinition = definition({ id: "m2" });
    expect(codes(validateRun(otherDefinition, instrument(), run()))).toEqual(["identity_mismatch"]);
    const otherInstrument = instrument({ repetitions: 9 });
    expect(codes(validateRun(definition(), otherInstrument, run()))).toEqual(["identity_mismatch"]);
  });

  test("a run records no score or timestamp field", () => {
    expect(validateRun(definition(), instrument(), run({ score: 1 })).ok).toBe(false);
    expect(validateRun(definition(), instrument(), run({ createdAt: "now" })).ok).toBe(false);
  });
});

describe("enforcement", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    definition: definition(),
    instrument: instrument(),
    gatePolicy: gatePolicy(),
    calibration: calibration(),
    ...overrides,
  });

  test("allows an enforced calibration whose three identities match", () => {
    expect(evaluateEnforcement(input())).toEqual({ enforce: true });
  });

  test("never enforces without a calibration and degrades as the policy declares", () => {
    const decision = evaluateEnforcement(input({ calibration: undefined }));
    expect(decision).toEqual({ enforce: false, reasons: ["no_calibration"], degradeTo: "shadow" });
  });

  test.each(["diagnostic", "shadow", "provisional", "expired", "revoked"])(
    "does not enforce a %s calibration",
    (status) => {
      const decision = evaluateEnforcement(input({ calibration: calibration({ status }) }));
      expect(decision).toEqual({ enforce: false, reasons: ["not_enforced"], degradeTo: "shadow" });
    },
  );

  test("a changed definition blocks enforcement", () => {
    const changed = definition({ criteria: [criterion("c1", "e1"), criterion("c9", "e9")] });
    expect(evaluateEnforcement(input({ definition: changed }))).toMatchObject({
      enforce: false,
      reasons: ["definition_mismatch"],
    });
  });

  test.each([
    ["model", { model: { provider: "p", name: "other" } }],
    ["decoding", { decoding: { temperature: 1 } }],
    ["prompt identity", { promptIdentity: hex("c") }],
    ["runtime", { runtime: { name: "r", version: "9" } }],
    ["repetitions", { repetitions: 99 }],
  ])("a changed instrument %s blocks enforcement", (_name, overrides) => {
    expect(evaluateEnforcement(input({ instrument: instrument(overrides) }))).toMatchObject({
      enforce: false,
      reasons: ["instrument_mismatch"],
    });
  });

  test("a changed gate policy blocks enforcement", () => {
    const changed = gatePolicy({ id: "g2", onUncalibrated: "diagnostic" });
    expect(evaluateEnforcement(input({ gatePolicy: changed }))).toEqual({
      enforce: false,
      reasons: ["gate_policy_mismatch"],
      degradeTo: "diagnostic",
    });
  });

  test("reports every applicable reason, not only the first", () => {
    const decision = evaluateEnforcement(
      input({
        calibration: calibration({ status: "revoked" }),
        definition: definition({ id: "m2" }),
        instrument: instrument({ repetitions: 9 }),
      }),
    );
    expect(decision).toMatchObject({
      enforce: false,
      reasons: ["not_enforced", "definition_mismatch", "instrument_mismatch"],
    });
  });

  test("degrades to indeterminate when no valid gate policy is available", () => {
    const decision = evaluateEnforcement(input({ gatePolicy: { schema: "nope" } }));
    expect(decision).toEqual({
      enforce: false,
      reasons: ["invalid_input"],
      degradeTo: "indeterminate",
    });
  });

  test.each([
    ["definition", { definition: null }],
    ["instrument", { instrument: 1 }],
    ["calibration", { calibration: [] }],
  ])("an invalid %s is reported without throwing", (_name, overrides) => {
    expect(() => evaluateEnforcement(input(overrides))).not.toThrow();
    expect(evaluateEnforcement(input(overrides))).toMatchObject({
      enforce: false,
      reasons: ["invalid_input"],
    });
  });
});

describe("calibration and gate policy shapes", () => {
  test("rejects an unknown status", () => {
    expect(validateCalibration(calibration({ status: "approved" })).ok).toBe(false);
  });

  test("rejects an unknown degradation", () => {
    expect(validateGatePolicy(gatePolicy({ onUncalibrated: "enforce" })).ok).toBe(false);
  });

  test("carries no thresholds, statistics, or confidence fields", () => {
    expect(validateCalibration(calibration({ threshold: 0.8 })).ok).toBe(false);
    expect(validateCalibration(calibration({ confidence: 0.9 })).ok).toBe(false);
    expect(validateGatePolicy(gatePolicy({ threshold: 0.8 })).ok).toBe(false);
  });

  test("rejects a malformed identity inside a calibration", () => {
    expect(validateCalibration(calibration({ definitionIdentity: "sha256:short" })).ok).toBe(false);
  });
});

describe("measurement key", () => {
  const keyOf = (evidence: readonly string[], d = definition(), i = instrument()) => {
    const result = measurementKey(d, i, evidence);
    if (!result.ok) {
      throw new Error(`expected a key: ${JSON.stringify(result.issues)}`);
    }
    return result.key;
  };

  test("is well formed and stable", () => {
    expect(keyOf([hex("1")])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(keyOf([hex("1")])).toBe(keyOf([hex("1")]));
  });

  test("changes with the definition, the instrument, or one evidence identity", () => {
    const base = keyOf([hex("1")]);
    expect(keyOf([hex("1")], definition({ id: "m2" }))).not.toBe(base);
    expect(keyOf([hex("1")], definition(), instrument({ repetitions: 9 }))).not.toBe(base);
    expect(keyOf([hex("2")])).not.toBe(base);
    expect(keyOf([hex("1"), hex("2")])).not.toBe(base);
    expect(keyOf([])).not.toBe(base);
  });

  test("ignores evidence order and duplicates", () => {
    expect(keyOf([hex("1"), hex("2"), hex("3")])).toBe(keyOf([hex("3"), hex("1"), hex("2")]));
    expect(keyOf([hex("1"), hex("2")])).toBe(keyOf([hex("2"), hex("1"), hex("1")]));
  });

  test("keeps the key apart from the identity of the same content", () => {
    const definitionId = id(definitionIdentity(definition()));
    expect(keyOf([])).not.toBe(definitionId);
  });

  test("rejects a malformed evidence identity and returns no key", () => {
    const result = measurementKey(definition(), instrument(), ["not-an-identity"]);
    expect(result.ok).toBe(false);
    expect("key" in result).toBe(false);
  });

  test("rejects an invalid definition or instrument", () => {
    expect(measurementKey(definition({ criteria: [] }), instrument(), []).ok).toBe(false);
    expect(measurementKey(definition(), { schema: "x" }, []).ok).toBe(false);
  });
});

describe("invalid input never throws", () => {
  const inputs: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 1],
    ["string", "x"],
    ["array", []],
    ["function", () => 1],
  ];

  test.each(inputs)("for %s", (_name, bad) => {
    for (const call of [
      () => validateDefinition(bad),
      () => validateInstrument(bad),
      () => validateGatePolicy(bad),
      () => validateCalibration(bad),
      () => definitionIdentity(bad),
      () => instrumentIdentity(bad),
      () => gatePolicyIdentity(bad),
      () => validateRun(bad, bad, bad),
      () => validateRun(definition(), instrument(), bad),
      () =>
        evaluateEnforcement({
          definition: bad,
          instrument: bad,
          gatePolicy: bad,
          calibration: bad,
        }),
      () => measurementKey(bad, bad, []),
    ]) {
      expect(call).not.toThrow();
    }
  });
});
