import { describe, expect, test } from "bun:test";
import {
  type CalibrationDataset,
  type Criterion,
  calibrationDatasetIdentity,
  definitionIdentity,
  type InstrumentProfile,
  identityOf,
  instrumentIdentity,
  type MeasurementDefinition,
  type Verdict,
  validateCalibrationDataset,
  validateCalibrationReport,
  validateGateDecision,
  validateGatePolicyForV2,
} from "@lorelum/judge-protocol";
import {
  buildCalibration,
  createDefaultGatePolicyV2,
  type EvaluateGateInput,
  evaluateGate,
  loadVerifiedCalibration,
} from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

function criterion(id: string, evidenceId: string): Criterion {
  return {
    schema: "lorelum.judge.criterion/v1",
    id,
    kind: "contract",
    description: `The implementation satisfies ${id}`,
    mandatory: true,
    source: { origin: "contract", ref: `AC-${id}` },
    anchors: [
      { verdict: "met", description: "The requirement is met" },
      { verdict: "unmet", description: "The requirement is not met" },
    ],
    evidence: [{ evidenceId, role: "primary" }],
  };
}

function definition(ids = ["c1"]): MeasurementDefinition {
  return {
    schema: "lorelum.judge.measurement-definition/v1",
    id: "measurement",
    criteria: ids.map((id, index) => criterion(id, `e${index + 1}`)),
  } as unknown as MeasurementDefinition;
}

function instrument(repetitions = 3): InstrumentProfile {
  return {
    schema: "lorelum.judge.instrument-profile/v1",
    model: { provider: "test", name: "deterministic", version: "1" },
    decoding: { temperature: 0, seed: 1 },
    promptIdentity: hex("a"),
    runtime: { name: "test-runtime", version: "1" },
    repetitions,
  };
}

function bundle(ids: readonly string[], present = true): Record<string, unknown> {
  return {
    schema: "lorelum.judge.evidence-bundle/v1",
    items: ids.map((id, index) =>
      present
        ? {
            schema: "lorelum.judge.evidence-item/v1",
            id,
            status: "present",
            contentIdentity: hex(String(index + 1)),
            render: { state: "rendered", originalLength: 5, renderedLength: 5 },
          }
        : { schema: "lorelum.judge.evidence-item/v1", id, status: "unavailable" },
    ),
  };
}

function run(
  measuredDefinition: MeasurementDefinition,
  measuredInstrument: InstrumentProfile,
  id: string,
  verdicts: Readonly<Record<string, Verdict["verdict"]>>,
): Record<string, unknown> {
  const defId = definitionIdentity(measuredDefinition);
  const instId = instrumentIdentity(measuredInstrument);
  if (!defId.ok || !instId.ok) throw new Error("test fixture identity failed");
  return {
    schema: "lorelum.judge.measurement-run/v1",
    id,
    definitionIdentity: defId.identity,
    instrumentIdentity: instId.identity,
    instrumentSource: "declared",
    verdicts: measuredDefinition.criteria.map((item, index) => ({
      schema: "lorelum.judge.verdict/v1",
      criterionId: item.id,
      verdict: verdicts[item.id] ?? "unknown",
      evidenceIds:
        verdicts[item.id] === "unknown" || verdicts[item.id] === "insufficient"
          ? []
          : [`e${index + 1}`],
    })),
  };
}

function makePolicy(
  measuredDefinition: MeasurementDefinition,
  measuredInstrument: InstrumentProfile,
) {
  const result = createDefaultGatePolicyV2({
    id: "default-v1",
    definition: measuredDefinition,
    instrument: measuredInstrument,
    scopes: [
      {
        taskClass: "backend",
        evidenceShape: "test-results",
        criterionIds: measuredDefinition.criteria.map((item) => item.id),
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function caseFor(
  measuredDefinition: MeasurementDefinition,
  measuredInstrument: InstrumentProfile,
  groupId: string,
  caseKind: "decisive" | "equivalent" | "anti" | "partial",
  expected: "met" | "unmet",
  prediction: "met" | "unmet" | "unknown" = expected,
  present = true,
) {
  const evidenceIds = measuredDefinition.criteria.map((_item, index) => `e${index + 1}`);
  return measuredDefinition.criteria.map((item, criterionIndex) => ({
    id: `${groupId}-${item.id}-${caseKind}`,
    criterionId: item.id,
    expectedVerdict: expected,
    caseKind,
    provenance: { origin: "user", ref: `gold:${groupId}` },
    evidenceIds: [evidenceIds[criterionIndex] ?? "e1"],
    observations: Array.from({ length: measuredInstrument.repetitions }, (_unused, repetition) => ({
      id: `${groupId}-${item.id}-${repetition}`,
      status: "completed",
      run: run(measuredDefinition, measuredInstrument, `${groupId}-${repetition}`, {
        [item.id]: prediction,
      }),
      evidenceBundle: bundle(evidenceIds, present),
    })),
  }));
}

function datasetFor(
  measuredDefinition: MeasurementDefinition,
  measuredInstrument: InstrumentProfile,
  groups: Array<{
    id: string;
    split?: "development" | "holdout";
    kind: "decisive" | "equivalent" | "anti" | "partial";
    expected: "met" | "unmet";
    prediction?: "met" | "unmet" | "unknown";
    present?: boolean;
  }>,
): CalibrationDataset {
  const defId = definitionIdentity(measuredDefinition);
  const instId = instrumentIdentity(measuredInstrument);
  if (!defId.ok || !instId.ok) throw new Error("test fixture identity failed");
  const taskGroups = groups.map((group) => {
    const taskId = identityOf("lorelum.judge.calibration-task/v1", { sourceTask: group.id });
    if (!taskId.ok) throw new Error("test fixture task identity failed");
    return {
      id: group.id,
      taskIdentity: taskId.identity,
      split: group.split ?? "holdout",
      taskClass: "backend",
      evidenceShape: "test-results",
      cases: caseFor(
        measuredDefinition,
        measuredInstrument,
        group.id,
        group.kind,
        group.expected,
        group.prediction ?? group.expected,
        group.present ?? true,
      ),
    };
  });
  return {
    schema: "lorelum.judge.calibration-dataset/v1",
    id: "known-cases",
    definitionIdentity: defId.identity,
    instrumentIdentity: instId.identity,
    taskGroups,
  } as unknown as CalibrationDataset;
}

function fullCalibrationFixture() {
  const measuredDefinition = definition();
  const measuredInstrument = instrument();
  const policy = makePolicy(measuredDefinition, measuredInstrument);
  const groups = [
    ...Array.from({ length: 80 }, (_unused, index) => ({
      id: `negative-${index}`,
      kind: "anti" as const,
      expected: "unmet" as const,
    })),
    ...Array.from({ length: 40 }, (_unused, index) => ({
      id: `positive-${index}`,
      kind: "decisive" as const,
      expected: "met" as const,
    })),
    ...Array.from({ length: 40 }, (_unused, index) => ({
      id: `equivalent-${index}`,
      kind: "equivalent" as const,
      expected: "met" as const,
    })),
  ];
  const dataset = datasetFor(measuredDefinition, measuredInstrument, groups);
  const built = buildCalibration({
    definition: measuredDefinition,
    instrument: measuredInstrument,
    policy,
    dataset,
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return { measuredDefinition, measuredInstrument, policy, dataset, built };
}

describe("calibration protocol", () => {
  test("validates task-group identity, provenance, repetitions, and evidence references", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const dataset = datasetFor(measuredDefinition, measuredInstrument, [
      { id: "one", kind: "equivalent", expected: "met" },
    ]);
    expect(
      validateCalibrationDataset(dataset, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(true);
    expect(calibrationDatasetIdentity(dataset).ok).toBe(true);
    const firstGroup = dataset.taskGroups[0];
    if (firstGroup === undefined) throw new Error("expected a calibration task group");
    const leaked = {
      ...dataset,
      taskGroups: [
        ...dataset.taskGroups,
        { ...firstGroup, id: `${firstGroup.id}-copy`, split: "development" as const },
      ],
    };
    expect(
      validateCalibrationDataset(leaked, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(false);
    const wrongIdentity = { ...dataset, instrumentIdentity: hex("f") };
    expect(
      validateCalibrationDataset(wrongIdentity, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(false);
    const short = structuredClone(dataset);
    const shortCase = short.taskGroups[0]?.cases[0];
    if (shortCase === undefined) throw new Error("expected a calibration case");
    shortCase.observations.pop();
    expect(
      validateCalibrationDataset(short, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(false);
    const repeatedRun = structuredClone(dataset);
    const repeatedCase = repeatedRun.taskGroups[0]?.cases[0];
    if (repeatedCase === undefined) throw new Error("expected a calibration case");
    const firstObservation = repeatedCase.observations[0];
    const secondObservation = repeatedCase.observations[1];
    if (firstObservation?.status !== "completed" || secondObservation?.status !== "completed") {
      throw new Error("expected completed observations");
    }
    secondObservation.run.id = firstObservation.run.id;
    expect(
      validateCalibrationDataset(repeatedRun, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(false);
    const absent = structuredClone(dataset);
    const absentCase = absent.taskGroups[0]?.cases[0];
    if (absentCase === undefined) throw new Error("expected a calibration case");
    absentCase.evidenceIds = ["not-in-bundle"];
    expect(
      validateCalibrationDataset(absent, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(false);
    const missingLabel = structuredClone(dataset);
    const unlabeledCase = missingLabel.taskGroups[0]?.cases[0];
    if (unlabeledCase === undefined) throw new Error("expected a calibration case");
    Reflect.deleteProperty(unlabeledCase, "expectedVerdict");
    expect(
      validateCalibrationDataset(missingLabel, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(false);
  });

  test("does not treat unsupported decisive evidence as a calibration failure label", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const dataset = datasetFor(measuredDefinition, measuredInstrument, [
      { id: "unsupported", kind: "anti", expected: "unmet", present: false },
    ]);
    const taskGroup = dataset.taskGroups[0];
    const originalCase = taskGroup?.cases[0];
    if (taskGroup === undefined || originalCase === undefined) {
      throw new Error("expected the unsupported-evidence fixture");
    }
    const variant = structuredClone(originalCase);
    variant.id = "unsupported-variant";
    for (const [index, observation] of variant.observations.entries()) {
      observation.id = `unsupported-variant-${index}`;
    }
    taskGroup.cases.push(variant);
    expect(
      validateCalibrationDataset(dataset, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(true);
    const built = buildCalibration({
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      dataset,
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.report.scopes[0]?.taskGroups).toBe(1);
      expect(built.value.report.scopes[0]?.cases).toBe(2);
      expect(built.value.report.scopes[0]?.observations).toBe(6);
      expect(built.value.report.scopes[0]?.abstention.numerator).toBe(1);
      expect(built.value.report.scopes[0]?.falseAccept.numerator).toBe(0);
      expect(built.value.report.scopes[0]?.failureCounts.evidence).toBe(1);
    }
  });

  test("preserves fully failed repetitions and their evidence without assigning a verdict", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const dataset = datasetFor(measuredDefinition, measuredInstrument, [
      { id: "provider-failed", kind: "anti", expected: "unmet" },
    ]);
    const taskGroup = dataset.taskGroups[0];
    const calibrationCase = taskGroup?.cases[0];
    if (taskGroup === undefined || calibrationCase === undefined) {
      throw new Error("expected a failed-measurement fixture");
    }
    calibrationCase.observations = calibrationCase.observations.map((_observation, index) => ({
      id: `provider-failed-${index}`,
      status: "failed",
      failureCategory: "provider",
      message: "provider unavailable",
      evidenceBundle: bundle(["e1"]),
    })) as unknown as typeof calibrationCase.observations;
    expect(
      validateCalibrationDataset(dataset, measuredDefinition, measuredInstrument, policy).ok,
    ).toBe(true);
    const built = buildCalibration({
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      dataset,
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      const scope = built.value.report.scopes[0];
      expect(scope?.observations).toBe(3);
      expect(scope?.abstention.numerator).toBe(1);
      expect(scope?.falseAccept.numerator).toBe(0);
      expect(scope?.failureCounts.provider).toBe(1);
    }
  });

  test("validates complete rates, zero denominators, and task-group count bounds", () => {
    const report = fullCalibrationFixture().built.value.report;
    expect(validateCalibrationReport(report).ok).toBe(true);

    const incomplete = structuredClone(report);
    const incompleteScope = incomplete.scopes[0];
    if (incompleteScope === undefined) throw new Error("expected a report scope");
    delete incompleteScope.falseAccept.upperBound;
    expect(validateCalibrationReport(incomplete).ok).toBe(false);

    const inconsistent = structuredClone(report);
    const inconsistentScope = inconsistent.scopes[0];
    if (inconsistentScope === undefined) throw new Error("expected a report scope");
    inconsistentScope.falseAccept.estimate = 0.25;
    expect(validateCalibrationReport(inconsistent).ok).toBe(false);

    const missingDenominator = structuredClone(report);
    const missingScope = missingDenominator.scopes[0];
    if (missingScope === undefined) throw new Error("expected a report scope");
    const zeroRate = missingScope.falseAccept;
    zeroRate.numerator = 0;
    zeroRate.denominator = 0;
    delete zeroRate.estimate;
    delete zeroRate.lowerBound;
    delete zeroRate.upperBound;
    missingScope.eligible = false;
    missingScope.reasons.push("missing_denominator");
    expect(validateCalibrationReport(missingDenominator).ok).toBe(true);

    zeroRate.estimate = 0;
    expect(validateCalibrationReport(missingDenominator).ok).toBe(false);

    const inflatedGroups = structuredClone(report);
    const inflatedScope = inflatedGroups.scopes[0];
    if (inflatedScope === undefined) throw new Error("expected a report scope");
    inflatedScope.failureCounts.provider = inflatedScope.taskGroups + 1;
    expect(validateCalibrationReport(inflatedGroups).ok).toBe(false);

    const unknownFailureCategory = structuredClone(report);
    const categoryScope = unknownFailureCategory.scopes[0];
    if (categoryScope === undefined) throw new Error("expected a report scope");
    categoryScope.failureCounts.guessed_root_cause = 1;
    expect(validateCalibrationReport(unknownFailureCategory).ok).toBe(false);
  });

  test("builds only artifacts with schema-valid timestamps", () => {
    const fixture = fullCalibrationFixture();
    const shared = {
      definition: fixture.measuredDefinition,
      instrument: fixture.measuredInstrument,
      policy: fixture.policy,
      dataset: fixture.dataset,
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z",
    };
    const dateOnlyFrom = buildCalibration({ ...shared, validFrom: "2026-01-01" });
    expect(dateOnlyFrom.ok).toBe(false);
    expect(
      !dateOnlyFrom.ok && dateOnlyFrom.issues.some((issue) => issue.path.endsWith("validFrom")),
    ).toBe(true);

    const dateOnlyUntil = buildCalibration({ ...shared, validUntil: "2027-01-01" });
    expect(dateOnlyUntil.ok).toBe(false);
    expect(
      !dateOnlyUntil.ok && dateOnlyUntil.issues.some((issue) => issue.path.endsWith("validUntil")),
    ).toBe(true);
  });
});

describe("calibration and gate behavior", () => {
  test("publishes the agreed default policy and qualifies only with held-out evidence", () => {
    const { policy, built } = fullCalibrationFixture();
    expect(policy.minimumAgreement).toBeCloseTo(2 / 3);
    expect(policy.minimumGroupsPerCaseKind).toBe(20);
    expect(policy.confidenceLevel).toBe(0.95);
    expect(policy.maximumFalseAcceptRate).toBe(0.05);
    expect(built.value.report.scopes[0]?.falseAccept.denominator).toBe(80);
    expect(built.value.report.scopes[0]?.falseAccept.upperBound).toBeLessThan(0.05);
    expect(built.value.report.scopes[0]?.eligible).toBe(true);
    expect(built.value.artifacts[0]?.status).toBe("shadow");
  });

  test("does not promote a small zero-error sample whose interval is still too wide", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const groups = [
      ...Array.from({ length: 20 }, (_unused, index) => ({
        id: `n-${index}`,
        kind: "anti" as const,
        expected: "unmet" as const,
      })),
      ...Array.from({ length: 20 }, (_unused, index) => ({
        id: `p-${index}`,
        kind: "decisive" as const,
        expected: "met" as const,
      })),
      ...Array.from({ length: 20 }, (_unused, index) => ({
        id: `e-${index}`,
        kind: "equivalent" as const,
        expected: "met" as const,
      })),
    ];
    const built = buildCalibration({
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      dataset: datasetFor(measuredDefinition, measuredInstrument, groups),
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.report.scopes[0]?.falseAccept.estimate).toBe(0);
      expect(built.value.report.scopes[0]?.falseAccept.upperBound).toBeGreaterThan(0.05);
      expect(built.value.report.scopes[0]?.eligible).toBe(false);
    }
  });

  test("a verified calibration cannot be forged by copying the enforced status", () => {
    const fixture = fullCalibrationFixture();
    const sourceArtifact = fixture.built.value.artifacts[0];
    if (sourceArtifact === undefined) throw new Error("expected a calibration artifact");
    const artifact = { ...sourceArtifact, status: "enforced" as const };
    const loaded = loadVerifiedCalibration({
      definition: fixture.measuredDefinition,
      instrument: fixture.measuredInstrument,
      policy: fixture.policy,
      dataset: fixture.dataset,
      report: fixture.built.value.report,
      artifact,
      validFrom: artifact.validFrom,
      validUntil: artifact.validUntil,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const copied = { ...loaded.value };
    const currentRun = run(fixture.measuredDefinition, fixture.measuredInstrument, "candidate", {
      c1: "met",
    });
    const decision = evaluateGate({
      id: "candidate-decision",
      definition: fixture.measuredDefinition,
      instrument: fixture.measuredInstrument,
      policy: fixture.policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `candidate-${index}`,
        status: "completed" as const,
        run: { ...currentRun, id: `candidate-${index}` },
        evidenceBundle: bundle(["e1"]),
      })),
      calibration: copied,
      now: "2026-10-13T00:00:00Z",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.value.executionMode).toBe("shadow");
  });

  test("recomputed in-scope calibration enforces and stale time or scope falls back", () => {
    const fixture = fullCalibrationFixture();
    const sourceArtifact = fixture.built.value.artifacts[0];
    if (sourceArtifact === undefined) throw new Error("expected a calibration artifact");
    const artifact = { ...sourceArtifact, status: "enforced" as const };
    const loaded = loadVerifiedCalibration({
      definition: fixture.measuredDefinition,
      instrument: fixture.measuredInstrument,
      policy: fixture.policy,
      dataset: fixture.dataset,
      report: fixture.built.value.report,
      artifact,
      validFrom: artifact.validFrom,
      validUntil: artifact.validUntil,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const candidate = run(fixture.measuredDefinition, fixture.measuredInstrument, "current", {
      c1: "met",
    });
    const makeDecision = (
      now: string,
      taskClass = "backend",
      calibration: unknown = loaded.value,
      activePolicy = fixture.policy,
      activeInstrument = fixture.measuredInstrument,
      activeDefinition = fixture.measuredDefinition,
      activeRun = candidate,
    ) =>
      evaluateGate({
        id: "candidate",
        definition: activeDefinition,
        instrument: activeInstrument,
        policy: activePolicy,
        taskClass,
        evidenceShape: "test-results",
        observations: Array.from({ length: 3 }, (_unused, index) => ({
          id: `current-${index}`,
          status: "completed" as const,
          run: { ...activeRun, id: `current-${index}` },
          evidenceBundle: bundle(["e1"]),
        })),
        calibration,
        now,
      });
    const enforced = makeDecision("2026-10-13T00:00:00Z");
    expect(enforced.ok && enforced.value.executionMode).toBe("enforced");
    const expired = makeDecision("2027-01-01T00:00:00Z");
    expect(expired.ok && expired.value.executionMode).toBe("shadow");
    const wrongScope = makeDecision("2026-10-13T00:00:00Z", "frontend");
    expect(wrongScope.ok && wrongScope.value.executionMode).toBe("indeterminate");
    expect(wrongScope.ok && wrongScope.value.qualityOutcome).toBe("indeterminate");
    expect(wrongScope.ok && wrongScope.value.findings[0]?.reason).toBe("not_applicable");

    for (const status of ["provisional", "expired", "revoked"] as const) {
      const staleArtifact = { ...artifact, status };
      const stale = loadVerifiedCalibration({
        definition: fixture.measuredDefinition,
        instrument: fixture.measuredInstrument,
        policy: fixture.policy,
        dataset: fixture.dataset,
        report: fixture.built.value.report,
        artifact: staleArtifact,
        validFrom: artifact.validFrom,
        validUntil: artifact.validUntil,
      });
      expect(stale.ok).toBe(true);
      if (stale.ok) {
        const degraded = makeDecision("2026-10-13T00:00:00Z", "backend", stale.value);
        expect(degraded.ok && degraded.value.executionMode).toBe("shadow");
      }
    }

    const changedPolicy = {
      ...fixture.policy,
      maximumFalseAcceptRate: fixture.policy.maximumFalseAcceptRate - 0.01,
    };
    const policyMismatch = makeDecision(
      "2026-10-13T00:00:00Z",
      "backend",
      loaded.value,
      changedPolicy,
    );
    expect(policyMismatch.ok && policyMismatch.value.executionMode).toBe("shadow");

    const changedInstrument = {
      ...fixture.measuredInstrument,
      model: { ...fixture.measuredInstrument.model, version: "2" },
    };
    const changedPolicyResult = createDefaultGatePolicyV2({
      id: "default-v1",
      definition: fixture.measuredDefinition,
      instrument: changedInstrument,
      scopes: fixture.policy.scopes,
    });
    if (!changedPolicyResult.ok) throw new Error(JSON.stringify(changedPolicyResult.issues));
    const changedRun = run(fixture.measuredDefinition, changedInstrument, "changed-model", {
      c1: "met",
    });
    const instrumentMismatch = makeDecision(
      "2026-10-13T00:00:00Z",
      "backend",
      loaded.value,
      changedPolicyResult.value,
      changedInstrument,
      fixture.measuredDefinition,
      changedRun,
    );
    expect(instrumentMismatch.ok && instrumentMismatch.value.executionMode).toBe("shadow");
  });

  test("supported mandatory failure wins over missing evidence and reports both in Chinese and English", () => {
    const measuredDefinition = definition(["c1", "c2"]);
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const decision = evaluateGate({
      id: "partial-evidence",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: ["unmet", "met", "unmet"].map((verdict, index) => ({
        id: `mixed-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `mixed-${index}`, {
          c1: verdict as "unmet" | "met",
          c2: "unknown",
        }),
        evidenceBundle: bundle(["e1", "e2"]),
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.qualityOutcome).toBe("fail");
      expect(decision.value.executionMode).toBe("shadow");
      expect(decision.value.findings.map((item) => item.outcome)).toEqual([
        "fail",
        "indeterminate",
      ]);
      expect(validateGateDecision(decision.value).ok).toBe(true);
      expect(validateGateDecision({ ...decision.value, qualityOutcome: "pass" }).ok).toBe(false);
      expect(decision.value.summary).toContain("未通过");
      const english = evaluateGate({
        id: "partial-evidence-en",
        definition: measuredDefinition,
        instrument: measuredInstrument,
        policy,
        taskClass: "backend",
        evidenceShape: "test-results",
        observations: ["unmet", "met", "unmet"].map((verdict, index) => ({
          id: `mixed-en-${index}`,
          status: "completed" as const,
          run: run(measuredDefinition, measuredInstrument, `mixed-en-${index}`, {
            c1: verdict as "unmet" | "met",
            c2: "unknown",
          }),
          evidenceBundle: bundle(["e1", "e2"]),
        })),
        now: "2026-10-13T00:00:00Z",
        locale: "en-US",
      });
      expect(english.ok && english.value.summary).toContain("Fail");
    }
  });

  test("two matching decisive observations meet the 2/3 rule while retaining disagreement", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const decision = evaluateGate({
      id: "majority",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: ["met", "met", "unmet"].map((verdict, index) => ({
        id: `majority-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `majority-${index}`, {
          c1: verdict as "met" | "unmet",
        }),
        evidenceBundle: bundle(["e1"]),
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.qualityOutcome).toBe("pass");
      expect(decision.value.findings[0]?.reason).toBe("disagreement");
      expect(decision.value.findings[0]?.message).toContain("分歧");
    }
  });

  test("optional unacceptable findings show their anchor without blocking acceptance", () => {
    const requiredDefinition = definition();
    const [firstCriterion, ...remainingCriteria] = requiredDefinition.criteria;
    if (firstCriterion === undefined) throw new Error("expected a criterion");
    const measuredDefinition: MeasurementDefinition = {
      ...requiredDefinition,
      criteria: [
        { ...firstCriterion, mandatory: false },
        ...remainingCriteria.map((item) => ({ ...item, mandatory: false })),
      ],
    };
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const evaluate = (locale: "zh-CN" | "en-US", id: string) =>
      evaluateGate({
        id,
        definition: measuredDefinition,
        instrument: measuredInstrument,
        policy,
        taskClass: "backend",
        evidenceShape: "test-results",
        observations: Array.from({ length: 3 }, (_unused, index) => ({
          id: `${id}-${index}`,
          status: "completed" as const,
          run: run(measuredDefinition, measuredInstrument, `${id}-${index}`, { c1: "unmet" }),
          evidenceBundle: bundle(["e1"]),
        })),
        now: "2026-10-13T00:00:00Z",
        locale,
      });

    const chinese = evaluate("zh-CN", "optional-unmet-zh");
    expect(chinese.ok && chinese.value.qualityOutcome).toBe("pass");
    expect(chinese.ok && chinese.value.findings[0]?.outcome).toBe("advisory");
    expect(chinese.ok && chinese.value.findings[0]?.reason).toBe("unacceptable");
    expect(chinese.ok && chinese.value.findings[0]?.message).toContain(
      "The requirement is not met",
    );
    expect(chinese.ok && chinese.value.findings[0]?.message).toContain("可选建议");
    expect(chinese.ok && chinese.value.findings[0]?.nextStep).toContain("不是必选阻塞项");

    const english = evaluate("en-US", "optional-unmet-en");
    expect(english.ok && english.value.findings[0]?.message).toContain(
      "The requirement is not met",
    );
    expect(english.ok && english.value.findings[0]?.message).toContain(
      "does not block overall acceptance",
    );

    const outOfScope = evaluateGate({
      id: "optional-out-of-scope",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "frontend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `optional-out-of-scope-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `optional-out-of-scope-${index}`, {
          c1: "met",
        }),
        evidenceBundle: bundle(["e1"]),
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(outOfScope.ok).toBe(true);
    expect(outOfScope.ok && outOfScope.value.qualityOutcome).toBe("indeterminate");
    expect(outOfScope.ok && outOfScope.value.executionMode).toBe("indeterminate");
    expect(outOfScope.ok && outOfScope.value.findings[0]?.outcome).toBe("advisory");
    expect(outOfScope.ok && outOfScope.value.findings[0]?.reason).toBe("not_applicable");
  });

  test("custom agreement threshold is part of policy identity and changes the result", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const base = makePolicy(measuredDefinition, measuredInstrument);
    const policy = { ...base, minimumAgreement: 0.99 };
    expect(validateGatePolicyForV2(policy, measuredDefinition, measuredInstrument).ok).toBe(true);
    const decision = evaluateGate({
      id: "custom-majority",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: ["met", "met", "unmet"].map((verdict, index) => ({
        id: `custom-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `custom-${index}`, {
          c1: verdict as "met" | "unmet",
        }),
        evidenceBundle: bundle(["e1"]),
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(decision.ok && decision.value.qualityOutcome).toBe("indeterminate");
    expect(decision.ok && decision.value.findings[0]?.reason).toBe("disagreement");
  });

  test("reports truncated, contradictory, unavailable, and unreferenced evidence without inventing failure", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const makeDecision = (
      evidenceBundle: unknown,
      verdict: "met" | "unmet" | "unknown" | "insufficient",
      id: string,
    ) =>
      evaluateGate({
        id,
        definition: measuredDefinition,
        instrument: measuredInstrument,
        policy,
        taskClass: "backend",
        evidenceShape: "test-results",
        observations: Array.from({ length: 3 }, (_unused, index) => ({
          id: `${id}-${index}`,
          status: "completed" as const,
          run: run(measuredDefinition, measuredInstrument, `${id}-${index}`, { c1: verdict }),
          evidenceBundle,
        })),
        now: "2026-10-13T00:00:00Z",
      });

    const truncated = bundle(["e1"]);
    const truncatedItem = (truncated.items as Array<Record<string, unknown>>)[0];
    if (truncatedItem === undefined) throw new Error("expected an evidence item");
    truncatedItem.render = { state: "truncated", originalLength: 10, renderedLength: 5 };
    const truncatedDecision = makeDecision(truncated, "unmet", "truncated");
    expect(truncatedDecision.ok && truncatedDecision.value.qualityOutcome).toBe("fail");

    const contradictory = {
      schema: "lorelum.judge.evidence-bundle/v1",
      items: [
        {
          schema: "lorelum.judge.evidence-item/v1",
          id: "e1",
          status: "contradiction",
          contentIdentity: hex("1"),
          render: { state: "rendered", originalLength: 5, renderedLength: 5 },
          conflictsWith: ["e2"],
        },
        {
          schema: "lorelum.judge.evidence-item/v1",
          id: "e2",
          status: "present",
          contentIdentity: hex("2"),
          render: { state: "rendered", originalLength: 5, renderedLength: 5 },
        },
      ],
    };
    const contradictionDecision = makeDecision(contradictory, "unmet", "contradictory");
    expect(contradictionDecision.ok && contradictionDecision.value.qualityOutcome).toBe(
      "indeterminate",
    );
    expect(contradictionDecision.ok && contradictionDecision.value.findings[0]?.reason).toBe(
      "unsupported_evidence",
    );

    const unavailableDecision = makeDecision(bundle(["e1"], false), "unknown", "unavailable");
    expect(unavailableDecision.ok && unavailableDecision.value.qualityOutcome).toBe(
      "indeterminate",
    );
    expect(unavailableDecision.ok && unavailableDecision.value.findings[0]?.reason).toBe(
      "unavailable_evidence",
    );
    expect(unavailableDecision.ok && unavailableDecision.value.findings[0]?.message).toContain(
      "当前不可读取",
    );
    expect(unavailableDecision.ok && unavailableDecision.value.findings[0]?.nextStep).toContain(
      "恢复不可读取证据的访问",
    );
    expect(
      unavailableDecision.ok && unavailableDecision.value.findings[0]?.evidenceStatuses,
    ).toEqual([{ evidenceId: "e1", status: "unavailable" }]);

    const noEvidenceBundle = {
      schema: "lorelum.judge.evidence-bundle/v1",
      items: [{ schema: "lorelum.judge.evidence-item/v1", id: "e1", status: "no_evidence" }],
    };
    const absentDecision = makeDecision(noEvidenceBundle, "unknown", "no-evidence");
    expect(absentDecision.ok && absentDecision.value.findings[0]?.reason).toBe("missing_evidence");
    expect(absentDecision.ok && absentDecision.value.findings[0]?.message).toContain("e1：未采集");
    expect(absentDecision.ok && absentDecision.value.findings[0]?.evidenceStatuses).toEqual([
      { evidenceId: "e1", status: "missing" },
    ]);

    const unknownWithEvidence = makeDecision(bundle(["e1"]), "unknown", "unknown-with-evidence");
    expect(unknownWithEvidence.ok && unknownWithEvidence.value.qualityOutcome).toBe(
      "indeterminate",
    );
    expect(unknownWithEvidence.ok && unknownWithEvidence.value.findings[0]?.reason).toBe(
      "abstention",
    );
    expect(
      unknownWithEvidence.ok && unknownWithEvidence.value.findings[0]?.requiredEvidenceIds,
    ).toEqual([]);
    expect(
      unknownWithEvidence.ok && unknownWithEvidence.value.findings[0]?.evidenceStatuses,
    ).toEqual([{ evidenceId: "e1", status: "available" }]);
    expect(unknownWithEvidence.ok && unknownWithEvidence.value.findings[0]?.message).toContain(
      "Judge 返回了",
    );
    expect(unknownWithEvidence.ok && unknownWithEvidence.value.findings[0]?.nextStep).toContain(
      "复核本次判断",
    );

    const insufficientWithEvidence = makeDecision(
      bundle(["e1"]),
      "insufficient",
      "insufficient-with-evidence",
    );
    expect(insufficientWithEvidence.ok && insufficientWithEvidence.value.findings[0]?.reason).toBe(
      "abstention",
    );

    const invalidReferenceDecision = makeDecision(bundle(["e2"]), "unmet", "invalid-reference");
    expect(invalidReferenceDecision.ok && invalidReferenceDecision.value.qualityOutcome).toBe(
      "indeterminate",
    );
    expect(invalidReferenceDecision.ok && invalidReferenceDecision.value.findings[0]?.reason).toBe(
      "unsupported_evidence",
    );
  });

  test("keeps failed evaluations and tied repetitions indeterminate", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const failed = evaluateGate({
      id: "provider-failure",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `provider-failure-${index}`,
        status: "failed" as const,
        failureCategory: "provider" as const,
        message: "provider unavailable",
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(failed.ok && failed.value.qualityOutcome).toBe("indeterminate");
    expect(failed.ok && failed.value.findings[0]?.reason).toBe("execution_failure");
    expect(failed.ok && failed.value.findings[0]?.failureCategories).toEqual(["provider"]);
    expect(failed.ok && failed.value.findings[0]?.nextStep).toContain("评审服务恢复");

    const promptFailure = evaluateGate({
      id: "prompt-failure",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `prompt-failure-${index}`,
        status: "failed" as const,
        failureCategory: "prompt" as const,
        message: "prompt configuration rejected",
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(promptFailure.ok && promptFailure.value.qualityOutcome).toBe("indeterminate");
    expect(promptFailure.ok && promptFailure.value.findings[0]?.reason).toBe("measurement_failure");
    expect(promptFailure.ok && promptFailure.value.findings[0]?.failureCategories).toEqual([
      "prompt",
    ]);
    expect(promptFailure.ok && promptFailure.value.findings[0]?.message).toContain("提示配置问题");

    const evidenceFailure = evaluateGate({
      id: "evidence-failure",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `evidence-failure-${index}`,
        status: "failed" as const,
        failureCategory: "evidence" as const,
        message: "evidence could not be read",
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(evidenceFailure.ok && evidenceFailure.value.qualityOutcome).toBe("indeterminate");
    expect(evidenceFailure.ok && evidenceFailure.value.findings[0]?.reason).toBe(
      "unsupported_evidence",
    );

    const unattributed = evaluateGate({
      id: "unattributed-failure",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `unattributed-failure-${index}`,
        status: "failed" as const,
        failureCategory: "unattributed" as const,
        message: "cause not known",
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(unattributed.ok && unattributed.value.qualityOutcome).toBe("indeterminate");
    expect(unattributed.ok && unattributed.value.findings[0]?.reason).toBe("unattributed_failure");
    expect(unattributed.ok && unattributed.value.findings[0]?.message).toContain("原因未能确定");
    expect(unattributed.ok && unattributed.value.findings[0]?.nextStep).toContain(
      "不要把它当作品质量失败",
    );

    const tied = evaluateGate({
      id: "tie",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: ["met", "unmet", "unknown"].map((verdict, index) => ({
        id: `tie-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `tie-${index}`, {
          c1: verdict as "met" | "unmet" | "unknown",
        }),
        evidenceBundle: bundle(["e1"]),
      })),
      now: "2026-10-13T00:00:00Z",
    });
    expect(tied.ok && tied.value.qualityOutcome).toBe("indeterminate");
    expect(tied.ok && tied.value.findings[0]?.reason).toBe("disagreement");
  });

  test("retains per-item status and remediation for mixed required evidence", () => {
    const baseDefinition = definition();
    const [firstCriterion, ...remainingCriteria] = baseDefinition.criteria;
    if (firstCriterion === undefined) throw new Error("expected a criterion");
    const measuredDefinition: MeasurementDefinition = {
      ...baseDefinition,
      criteria: [
        {
          ...firstCriterion,
          evidence: [
            { evidenceId: "e1", role: "primary" },
            { evidenceId: "e2", role: "reference" },
            { evidenceId: "e3", role: "reference" },
          ],
        },
        ...remainingCriteria,
      ],
    };
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const evidenceBundle = {
      schema: "lorelum.judge.evidence-bundle/v1",
      items: [
        { schema: "lorelum.judge.evidence-item/v1", id: "e1", status: "unavailable" },
        { schema: "lorelum.judge.evidence-item/v1", id: "e2", status: "no_evidence" },
        {
          schema: "lorelum.judge.evidence-item/v1",
          id: "e3",
          status: "present",
          contentIdentity: hex("3"),
          render: { state: "rendered", originalLength: 8, renderedLength: 8 },
        },
      ],
    };
    const decision = evaluateGate({
      id: "mixed-evidence-statuses",
      definition: measuredDefinition,
      instrument: measuredInstrument,
      policy,
      taskClass: "backend",
      evidenceShape: "test-results",
      observations: Array.from({ length: 3 }, (_unused, index) => ({
        id: `mixed-evidence-statuses-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `mixed-evidence-statuses-${index}`, {
          c1: "unknown",
        }),
        evidenceBundle,
      })),
      now: "2026-10-13T00:00:00Z",
    });

    expect(decision.ok && decision.value.findings[0]?.reason).toBe("unavailable_evidence");
    expect(decision.ok && decision.value.findings[0]?.evidenceStatuses).toEqual([
      { evidenceId: "e1", status: "unavailable" },
      { evidenceId: "e2", status: "missing" },
      { evidenceId: "e3", status: "available" },
    ]);
    expect(decision.ok && decision.value.findings[0]?.message).toContain(
      "e1：当前不可读取；e2：未采集；e3：可读取",
    );
    expect(decision.ok && decision.value.findings[0]?.nextStep).toContain("补充尚未采集的证据");
    expect(decision.ok && decision.value.findings[0]?.nextStep).toContain("恢复不可读取证据的访问");
  });

  test("rejects duplicate measurement runs and excess observations instead of replacing them", () => {
    const measuredDefinition = definition();
    const measuredInstrument = instrument();
    const policy = makePolicy(measuredDefinition, measuredInstrument);
    const decide = (observations: EvaluateGateInput["observations"]) =>
      evaluateGate({
        id: "invalid-current-observations",
        definition: measuredDefinition,
        instrument: measuredInstrument,
        policy,
        taskClass: "backend",
        evidenceShape: "test-results",
        observations,
        now: "2026-10-13T00:00:00Z",
      });
    const repeatedRun = decide(
      Array.from({ length: 3 }, (_unused, index) => ({
        id: `observation-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, "same-run", { c1: "met" }),
        evidenceBundle: bundle(["e1"]),
      })),
    );
    expect(repeatedRun.ok).toBe(false);
    expect(
      !repeatedRun.ok && repeatedRun.issues.some((issue) => issue.code === "duplicate_verdict"),
    ).toBe(true);

    const excess = decide(
      Array.from({ length: 4 }, (_unused, index) => ({
        id: `excess-${index}`,
        status: "completed" as const,
        run: run(measuredDefinition, measuredInstrument, `excess-run-${index}`, { c1: "met" }),
        evidenceBundle: bundle(["e1"]),
      })),
    );
    expect(excess.ok).toBe(false);
    expect(!excess.ok && excess.issues[0]?.code).toBe("report_mismatch");
  });
});
