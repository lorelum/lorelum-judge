import { describe, expect, test } from "bun:test";
import {
  canonicalForm,
  definitionIdentity,
  evaluateEnforcement,
  evidenceBundleIdentity,
  gatePolicyIdentity,
  identityOf,
  instrumentIdentity,
  measurementKey,
  taskContractIdentity,
  validateCalibration,
  validateCriteria,
  validateCriterion,
  validateCriterionDraft,
  validateDefinition,
  validateEvidenceBundle,
  validateGatePolicy,
  validateInstrument,
  validateRun,
  validateTaskContract,
  validateVerdict,
  validateVerdictEvidence,
} from "../src/index.js";
import { snapshot } from "../src/validation.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

const criterion = {
  schema: "lorelum.judge.criterion/v1",
  id: "c1",
  kind: "contract",
  description: "criterion c1",
  mandatory: true,
  source: { origin: "contract", ref: "AC-c1" },
  anchors: [
    { verdict: "met", description: "satisfied" },
    { verdict: "unmet", description: "not satisfied" },
  ],
  evidence: [{ evidenceId: "e1", role: "primary" }],
};

const definition = {
  schema: "lorelum.judge.measurement-definition/v1",
  id: "m1",
  criteria: [criterion],
};

const instrument = {
  schema: "lorelum.judge.instrument-profile/v1",
  model: { provider: "p", name: "m", version: "1" },
  decoding: { temperature: 0, topP: 1, maxTokens: 1024, seed: 7 },
  promptIdentity: hex("a"),
  runtime: { name: "r", version: "1.0.0" },
  repetitions: 3,
};

const gatePolicy = {
  schema: "lorelum.judge.gate-policy/v1",
  id: "g1",
  onUncalibrated: "shadow",
};

const verdict = {
  schema: "lorelum.judge.verdict/v1",
  criterionId: "c1",
  verdict: "met",
  evidenceIds: ["e1"],
};

const bundle = {
  schema: "lorelum.judge.evidence-bundle/v1",
  items: [
    {
      schema: "lorelum.judge.evidence-item/v1",
      id: "e1",
      status: "present",
      contentIdentity: hex("c"),
      render: { state: "rendered", originalLength: 10, renderedLength: 10 },
    },
  ],
};

function identityOfOk(outcome: { ok: boolean; identity?: string }): string {
  if (!outcome.ok || outcome.identity === undefined) {
    throw new Error("expected an identity");
  }
  return outcome.identity;
}

const run = {
  schema: "lorelum.judge.measurement-run/v1",
  id: "r1",
  definitionIdentity: identityOfOk(definitionIdentity(definition)),
  instrumentIdentity: identityOfOk(instrumentIdentity(instrument)),
  instrumentSource: "declared",
  verdicts: [verdict],
};

const calibration = {
  schema: "lorelum.judge.calibration-artifact/v1",
  id: "k1",
  definitionIdentity: identityOfOk(definitionIdentity(definition)),
  instrumentIdentity: identityOfOk(instrumentIdentity(instrument)),
  gatePolicyIdentity: identityOfOk(gatePolicyIdentity(gatePolicy)),
  status: "enforced",
};

/**
 * An object whose fields all live on its prototype. `ajv` reads inherited properties
 * while hashing sees own ones only, so without a snapshot it would validate and then be
 * hashed without its content.
 */
const inherit = (value: object): object => Object.create(value);

// Each case runs a function once with valid input and once with the same input inherited.
const cases: readonly (readonly [string, (wrap: (value: object) => object) => { ok: boolean }])[] =
  [
    ["validateCriterion", (w) => validateCriterion(w(criterion))],
    ["validateCriterionDraft", (w) => validateCriterionDraft(w(criterion))],
    ["validateCriteria", (w) => validateCriteria([w(criterion)])],
    ["validateVerdict (verdict)", (w) => validateVerdict(criterion, w(verdict))],
    ["validateVerdict (criterion)", (w) => validateVerdict(w(criterion), verdict)],
    ["validateEvidenceBundle", (w) => validateEvidenceBundle(w(bundle))],
    ["evidenceBundleIdentity", (w) => evidenceBundleIdentity(w(bundle))],
    [
      "validateVerdictEvidence (bundle)",
      (w) => validateVerdictEvidence(criterion, verdict, w(bundle)),
    ],
    ["validateDefinition", (w) => validateDefinition(w(definition))],
    ["definitionIdentity", (w) => definitionIdentity(w(definition))],
    ["validateInstrument", (w) => validateInstrument(w(instrument))],
    ["instrumentIdentity", (w) => instrumentIdentity(w(instrument))],
    ["validateGatePolicy", (w) => validateGatePolicy(w(gatePolicy))],
    ["gatePolicyIdentity", (w) => gatePolicyIdentity(w(gatePolicy))],
    ["validateCalibration", (w) => validateCalibration(w(calibration))],
    ["validateRun (run)", (w) => validateRun(definition, instrument, w(run))],
    ["validateRun (definition)", (w) => validateRun(w(definition), instrument, run)],
    ["measurementKey (definition)", (w) => measurementKey(w(definition), instrument, [])],
    ["measurementKey (instrument)", (w) => measurementKey(definition, w(instrument), [])],
  ];

describe("inherited fields are not validated and then hashed without their content", () => {
  test.each(cases)("%s accepts the plain input", (_name, call) => {
    expect(call((value) => value).ok).toBe(true);
  });

  test.each(cases)("%s rejects the same input when its fields are inherited", (_name, call) => {
    expect(call(inherit).ok).toBe(false);
  });

  test("two different inherited definitions do not share an identity", () => {
    const one = definitionIdentity(inherit({ ...definition, id: "one" }));
    const two = definitionIdentity(inherit({ ...definition, id: "two" }));
    expect(one.ok).toBe(false);
    expect(two.ok).toBe(false);
  });
});

describe("a getter is read once", () => {
  test("a definition's identity covers the value that was validated", () => {
    let reads = 0;
    const stateful = {
      ...definition,
      get id(): string {
        reads += 1;
        return reads === 1 ? "first" : "later";
      },
    };
    const result = validateDefinition(stateful);
    expect(reads).toBe(1);
    expect(result.ok && result.value.id).toBe("first");
  });

  test("an evidence bundle's identity is the identity of what was validated", () => {
    let reads = 0;
    const stateful = {
      ...bundle,
      get items(): unknown {
        reads += 1;
        return reads === 1 ? bundle.items : [{ ...bundle.items[0], contentIdentity: hex("d") }];
      },
    };
    const outcome = evidenceBundleIdentity(stateful);
    expect(reads).toBe(1);
    expect(outcome).toEqual(evidenceBundleIdentity(bundle));
  });

  test("enforcement reads input.gatePolicy exactly once", () => {
    let reads = 0;
    const input = {
      definition,
      instrument,
      get gatePolicy(): unknown {
        reads += 1;
        return reads === 1 ? gatePolicy : { ...gatePolicy, onUncalibrated: "diagnostic" };
      },
      calibration,
    };
    // The calibration was made for the first policy. A second read would hash a different
    // policy and refuse to enforce.
    expect(evaluateEnforcement(input)).toEqual({ enforce: true });
    expect(reads).toBe(1);
  });
});

describe("enforcement reads a policy object once", () => {
  test("a getter inside the policy is not read again for the identity", () => {
    let reads = 0;
    const statefulPolicy = {
      ...gatePolicy,
      get id(): string {
        reads += 1;
        return reads === 1 ? "g1" : "g2";
      },
    };
    const decision = evaluateEnforcement({
      definition,
      instrument,
      gatePolicy: statefulPolicy,
      calibration,
    });
    expect(decision).toEqual({ enforce: true });
    expect(reads).toBe(1);
  });
});

describe("the copy accepts plain data only", () => {
  const taskContract = (overrides: Record<string, unknown> = {}) => ({
    schema: "lorelum.judge.task-contract/v1",
    id: "t1",
    taskClass: "cli",
    text: "Add a --json option",
    acceptance: [{ id: "a1", text: "requirement", source: { origin: "contract", ref: "AC-1" } }],
    ...overrides,
  });

  test("the plain contract is accepted", () => {
    expect(validateTaskContract(taskContract()).ok).toBe(true);
  });

  test.each([
    ["a Date where a string is expected", () => taskContract({ text: new Date(0) })],
    ["a boxed String", () => taskContract({ text: new String("boxed") })],
    ["a boxed Number", () => taskContract({ id: new Number(1) })],
    ["a class instance", () => new (class Holder {})()],
    ["a Date as the whole input", () => new Date(0)],
    [
      "a toJSON that would change the content",
      () => ({ ...taskContract(), toJSON: () => taskContract({ id: "other" }) }),
    ],
    ["an undefined array element", () => taskContract({ acceptance: [undefined] })],
    ["a NaN", () => taskContract({ text: Number.NaN })],
    ["a function", () => taskContract({ text: () => "x" })],
    ["a symbol", () => taskContract({ text: Symbol("x") })],
    [
      "an array that only inherits its element",
      () => {
        const inherited = new Array(1);
        Object.setPrototypeOf(inherited, [taskContract().acceptance[0]]);
        return taskContract({ acceptance: inherited });
      },
    ],
  ])("%s is rejected, not converted", (_name, build) => {
    const result = validateTaskContract(build());
    expect(result.ok).toBe(false);
  });

  test("a toJSON method is never called", () => {
    let calls = 0;
    const withToJson = {
      ...taskContract(),
      toJSON: () => {
        calls += 1;
        return taskContract();
      },
    };
    validateTaskContract(withToJson);
    expect(calls).toBe(0);
  });

  test("a lone surrogate is invalid for validation and for the identity alike", () => {
    const input = taskContract({ text: "\ud800" });
    expect(validateTaskContract(input).ok).toBe(false);
    expect(taskContractIdentity(input).ok).toBe(false);
  });

  test("a key named __proto__ stays an own key and does not become a prototype", () => {
    const copy = snapshot(JSON.parse('{"__proto__": {"polluted": true}, "id": "x"}')) as object;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.hasOwn(copy, "__proto__")).toBe(true);
    expect((copy as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("a property that is undefined is kept in the copy, as the caller wrote it", () => {
    const copy = snapshot({ a: 1, b: undefined }) as object;
    expect(Object.keys(copy)).toEqual(["a", "b"]);
  });
});

describe("snapshot rules that the schemas would not catch", () => {
  class Holder {
    a = 1;
  }

  test("a class instance with valid own fields is rejected", () => {
    expect(() => snapshot(new Holder())).toThrow("only plain objects and arrays");
  });

  test("a null-prototype object is accepted and copied", () => {
    const bare = Object.assign(Object.create(null), { a: 1 });
    expect(snapshot(bare)).toEqual({ a: 1 });
  });

  test("an undefined array element is rejected rather than turned into null", () => {
    expect(() => snapshot([1, undefined])).toThrow("undefined is not allowed in an array");
  });

  test("a valid class instance cannot pass a schema through its own fields", () => {
    const instance = Object.assign(new Holder(), {
      schema: "lorelum.judge.gate-policy/v1",
      id: "g1",
      onUncalibrated: "shadow",
    });
    expect(validateGatePolicy(instance).ok).toBe(false);
  });
});

describe("identity functions copy their input", () => {
  test("a Date is not hashed as its ISO string", () => {
    const asDate = identityOf("x", new Date(0));
    expect(asDate.ok).toBe(false);
    if (!asDate.ok) {
      expect(asDate.error.reason).toBe("unsupported");
    }
  });

  test("a class instance is not hashed as a plain object", () => {
    class Holder {
      a = 1;
    }
    expect(identityOf("x", new Holder()).ok).toBe(false);
  });

  test("canonicalForm of a Date is a failed result", () => {
    expect(canonicalForm(new Date(0)).ok).toBe(false);
  });

  test("canonicalForm of a throwing getter is a failed result", () => {
    const hostile = {
      get a(): number {
        throw new Error("boom");
      },
    };
    expect(canonicalForm(hostile).ok).toBe(false);
  });

  test("a throwing getter is a failed result, not a throw", () => {
    const hostile = {
      get a(): number {
        throw new Error("boom");
      },
    };
    expect(identityOf("x", hostile).ok).toBe(false);
  });

  test("a lone surrogate is a failed result", () => {
    expect(identityOf("x", { a: "\ud800" }).ok).toBe(false);
  });

  const holeArray = (): unknown[] => {
    const array: unknown[] = [1, 2, 3];
    delete array[1];
    return array;
  };

  test.each([
    [
      "a bigint before a function",
      { a: 1n, f: () => 1 },
      { path: "$.value.a", reason: "bigint" as const },
    ],
    [
      "NaN before a lone surrogate",
      { a: Number.NaN, s: "\ud800" },
      { path: "$.value.a", reason: "not_finite" as const },
    ],
    [
      "a bigint before a Date",
      { a: 1n, d: new Date(0) },
      { path: "$.value.a", reason: "bigint" as const },
    ],
    [
      "an undefined before a bigint",
      { a: undefined, b: 1n },
      { path: "$.value.a", reason: "undefined" as const },
    ],
    ["an array hole", { a: holeArray() }, { path: "$.value.a[1]", reason: "undefined" as const }],
  ])("reports the first defect in order: %s", (_name, value, expected) => {
    const outcome = identityOf("x", value);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual(expected);
    }
  });

  test("measurementKey rejects an evidence list with an extra own property", () => {
    const withExtra = Object.assign([hex("1")], { note: "x" });
    expect(measurementKey(definition, instrument, withExtra).ok).toBe(false);
  });

  test("measurementKey rejects an evidence list with a symbol key", () => {
    const withSymbol = Object.assign([hex("1")], { [Symbol("s")]: 1 });
    expect(measurementKey(definition, instrument, withSymbol).ok).toBe(false);
  });

  test("a throwing getter is reported at the path of the property it reads", () => {
    const nested = {
      a: {
        get b(): number {
          throw new Error("boom");
        },
      },
    };
    const outcome = identityOf("x", nested);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual({ path: "$.value.a.b", reason: "unsupported" });
    }
  });

  test("an array's own extra property is reported before its NaN element", () => {
    const outcome = identityOf("x", { a: Object.assign([Number.NaN], { note: 1 }) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual({ path: "$.value.a", reason: "unsupported" });
    }
  });

  test("an object's symbol key is reported before its bigint child", () => {
    const outcome = identityOf("x", { a: 1n, [Symbol("s")]: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual({ path: "$.value", reason: "unsupported" });
    }
  });

  test("a deep input is a failed result", () => {
    let deep: unknown = 1;
    for (let depth = 0; depth < 40000; depth += 1) {
      deep = [deep];
    }
    expect(identityOf("x", deep).ok).toBe(false);
  });

  test("an undefined property is reported with reason undefined", () => {
    const outcome = identityOf("x", { a: 1, b: undefined });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual({ path: "$.value.b", reason: "undefined" });
    }
  });

  test("a schema with an extra undefined key is rejected by the validator", () => {
    expect(validateGatePolicy({ ...gatePolicy, extra: undefined }).ok).toBe(false);
  });

  test("a symbol key is rejected by the copy", () => {
    expect(() => snapshot({ [Symbol("s")]: 1 })).toThrow("symbol keys are not allowed");
  });

  test("a non-enumerable own property is rejected by the copy", () => {
    const hidden = Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false });
    expect(() => snapshot(hidden)).toThrow("only own enumerable properties");
  });

  test("a lone-surrogate key is rejected by the copy", () => {
    expect(() => snapshot({ "\ud800": 1 })).toThrow("a lone surrogate is not allowed in a key");
  });

  test("an extra own property on an array is rejected by the copy", () => {
    const withExtra = Object.assign([1, 2], { note: "x" });
    expect(() => snapshot(withExtra)).toThrow("an array may only have its elements");
  });
});
