import { describe, expect, test } from "bun:test";

import {
  evidenceBundleIdentity,
  instrumentIdentityV2,
  measurementDefinitionIdentityV2,
  validateCalibrationDataset,
  validateGatePolicyV2,
} from "@lorelum/judge-protocol";

import { buildCalibration, loadVerifiedCalibration } from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

function definition() {
  return {
    schema: "lorelum.judge.measurement-definition/v2",
    id: "review",
    criteria: [
      {
        schema: "lorelum.judge.criterion/v1",
        id: "c1",
        kind: "contract" as const,
        description: "criterion c1",
        mandatory: true,
        source: { origin: "contract" as const, ref: "AC-1" },
        anchors: [
          { verdict: "met" as const, description: "satisfied" },
          { verdict: "unmet" as const, description: "not satisfied" },
        ],
        evidence: [{ evidenceId: "e1", role: "primary" as const }],
      },
    ],
    metadata: [{ criterionId: "c1", role: "advisory" as const, covers: [], appliesTo: ["code"] }],
  };
}

function instrument() {
  return {
    schema: "lorelum.judge.instrument-profile/v2",
    method: {
      kind: "program" as const,
      checker: { id: "offline", version: "1" },
      implementationVersion: "review/v1",
      resultProtocolVersion: "result/v1",
      parserVersion: "parser/v1",
      runtime: { name: "judge", version: "0.0.0" },
      repetitions: 1,
    },
  };
}

function policy(
  definitionInput: ReturnType<typeof definition>,
  instrumentInput: ReturnType<typeof instrument>,
) {
  const definitionId = measurementDefinitionIdentityV2(definitionInput);
  const instrumentId = instrumentIdentityV2(instrumentInput);
  if (!definitionId.ok || !instrumentId.ok) throw new Error("fixture identity failed");
  const result = validateGatePolicyV2({
    schema: "lorelum.judge.gate-policy/v2",
    id: "policy",
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
    scopes: [{ taskClass: "code", evidenceShape: "code", criterionIds: ["c1"] }],
    criteria: [
      {
        criterionId: "c1",
        acceptedVerdicts: ["met"],
        requiredCaseKinds: ["decisive", "equivalent", "anti"],
      },
    ],
    minimumAgreement: 1,
    minimumGroupsPerCaseKind: 1,
    confidenceLevel: 0.95,
    maximumFalseAcceptRate: 0.05,
    maximumFalseRejectRate: 0.1,
    maximumAbstentionRate: 0.2,
    maximumDisagreementRate: 0.2,
    onUncalibrated: "diagnostic",
  });
  if (!result.ok) throw new Error("fixture policy invalid");
  return result.value;
}

function fixtures() {
  const definitionInput = definition();
  const instrumentInput = instrument();
  const definitionId = measurementDefinitionIdentityV2(definitionInput);
  const instrumentId = instrumentIdentityV2(instrumentInput);
  if (!definitionId.ok || !instrumentId.ok) throw new Error("fixture identity failed");
  const evidenceBundle = {
    schema: "lorelum.judge.evidence-bundle/v1",
    items: [
      {
        schema: "lorelum.judge.evidence-item/v1",
        id: "e1",
        status: "present",
        contentIdentity: hex("1"),
        render: { state: "rendered", originalLength: 4, renderedLength: 4 },
      },
    ],
  };
  const evidenceId = evidenceBundleIdentity(evidenceBundle);
  if (!evidenceId.ok) throw new Error("fixture evidence invalid");
  const run = {
    schema: "lorelum.judge.measurement-run/v2",
    id: "run-1",
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
    instrumentSource: "declared",
    executionId: "exec-1",
    evidenceIdentity: evidenceId.identity,
    verdicts: [
      {
        schema: "lorelum.judge.verdict/v1",
        criterionId: "c1",
        verdict: "met",
        evidenceIds: ["e1"],
      },
    ],
  };
  const dataset = {
    schema: "lorelum.judge.calibration-dataset/v1",
    id: "dataset",
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
    taskGroups: [
      {
        id: "group",
        taskIdentity: hex("2"),
        split: "holdout",
        taskClass: "code",
        evidenceShape: "code",
        cases: [
          {
            id: "case",
            criterionId: "c1",
            expectedVerdict: "met",
            caseKind: "decisive",
            provenance: { origin: "user", ref: "fixture" },
            evidenceIds: ["e1"],
            observations: [{ id: "observation", status: "completed", run, evidenceBundle }],
          },
        ],
      },
    ],
  };
  return {
    definition: definitionInput,
    instrument: instrumentInput,
    policy: policy(definitionInput, instrumentInput),
    dataset,
  };
}

describe("v2 calibration records", () => {
  test("a v2 run is accepted by dataset validation", () => {
    const value = fixtures();
    const result = validateCalibrationDataset(
      value.dataset,
      value.definition,
      value.instrument,
      value.policy,
    );
    expect(result.ok).toBe(true);
  });

  test("a v2 run must match its evidence bundle", () => {
    const value = fixtures();
    const group = value.dataset.taskGroups[0];
    const observation = group?.cases[0]?.observations[0];
    if (observation === undefined || observation.status !== "completed") {
      throw new Error("fixture observation missing");
    }
    const item = observation.evidenceBundle.items[0];
    if (item === undefined) throw new Error("fixture evidence missing");
    observation.evidenceBundle.items[0] = { ...item, contentIdentity: hex("9") };
    const result = validateCalibrationDataset(
      value.dataset,
      value.definition,
      value.instrument,
      value.policy,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("identity_mismatch");
    }
  });

  test("verified loading recomputes v2 report and identities", () => {
    const value = fixtures();
    const built = buildCalibration({
      dataset: value.dataset,
      definition: value.definition,
      instrument: value.instrument,
      policy: value.policy,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.artifacts).toHaveLength(1);
    const artifact = built.value.artifacts[0];
    expect(artifact).toBeDefined();
    if (artifact === undefined) return;
    const loaded = loadVerifiedCalibration({
      dataset: value.dataset,
      definition: value.definition,
      instrument: value.instrument,
      policy: value.policy,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      report: built.value.report,
      artifact,
    });
    expect(loaded.ok).toBe(true);
    const instrumentId = instrumentIdentityV2(value.instrument);
    expect(instrumentId.ok).toBe(true);
    if (loaded.ok && instrumentId.ok) {
      expect(loaded.value.instrumentIdentity).toBe(instrumentId.identity);
      expect(artifact.instrumentIdentity).toBe(instrumentId.identity);
    }
  });
});
