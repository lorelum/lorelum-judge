import {
  type CalibrationDataset,
  type Criterion,
  definitionIdentity,
  type InstrumentProfile,
  identityOf,
  instrumentIdentity,
  type MeasurementDefinition,
  type Verdict,
} from "@lorelum/judge-protocol";
import { buildCalibration, createDefaultGatePolicyV2 } from "../src/index.js";

export const hex = (character: string) => `sha256:${character.repeat(64)}`;

export function criterion(id: string, evidenceId: string): Criterion {
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

export function definition(ids = ["c1"]): MeasurementDefinition {
  return {
    schema: "lorelum.judge.measurement-definition/v1",
    id: "measurement",
    criteria: ids.map((id, index) => criterion(id, `e${index + 1}`)),
  } as unknown as MeasurementDefinition;
}

export function instrument(repetitions = 3): InstrumentProfile {
  return {
    schema: "lorelum.judge.instrument-profile/v1",
    model: { provider: "test", name: "deterministic", version: "1" },
    decoding: { temperature: 0, seed: 1 },
    promptIdentity: hex("a"),
    runtime: { name: "test-runtime", version: "1" },
    repetitions,
  };
}

export function bundle(ids: readonly string[], present = true): Record<string, unknown> {
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

export function run(
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

export function makePolicy(
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

export function caseFor(
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

export function datasetFor(
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

export function fullCalibrationFixture() {
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
