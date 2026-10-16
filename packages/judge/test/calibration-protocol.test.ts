import { describe, expect, test } from "bun:test";
import {
  calibrationDatasetIdentity,
  validateCalibrationDataset,
  validateCalibrationReport,
} from "@lorelum/judge-protocol";
import { buildCalibration } from "../src/index.js";

import {
  bundle,
  datasetFor,
  definition,
  fullCalibrationFixture,
  hex,
  instrument,
  makePolicy,
} from "./calibration-gate.fixtures.js";

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
    const reusedAcrossGroups = datasetFor(measuredDefinition, measuredInstrument, [
      { id: "first-group", kind: "equivalent", expected: "met" },
      { id: "second-group", kind: "equivalent", expected: "met" },
    ]);
    const firstRun = reusedAcrossGroups.taskGroups[0]?.cases[0]?.observations[0];
    const secondRun = reusedAcrossGroups.taskGroups[1]?.cases[0]?.observations[0];
    if (firstRun?.status !== "completed" || secondRun?.status !== "completed") {
      throw new Error("expected completed observations in both task groups");
    }
    secondRun.run.id = firstRun.run.id;
    expect(
      validateCalibrationDataset(reusedAcrossGroups, measuredDefinition, measuredInstrument, policy)
        .ok,
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
