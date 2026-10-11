import { describe, expect, test } from "bun:test";

import {
  definitionIdentity,
  evaluateEnforcement,
  evidenceBundleIdentity,
  gatePolicyIdentity,
  instrumentIdentity,
  measurementKey,
  validateCalibration,
  validateCriteria,
  validateCriterion,
  validateCriterionDraft,
  validateDefinition,
  validateEvidenceBundle,
  validateGatePolicy,
  validateInstrument,
  validateRun,
  validateVerdict,
  validateVerdictEvidence,
} from "../src/index.js";

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

  test("enforcement compares the calibration with the policy it degrades by", () => {
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
