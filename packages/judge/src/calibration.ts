import type { Criterion, Verdict } from "@lorelum/judge-protocol";
import {
  aggregateVerdicts,
  anyDefinitionIdentity,
  anyInstrumentIdentity,
  type CalibrationArtifactV2,
  type CalibrationCase,
  type CalibrationReport,
  calibrationDatasetIdentity,
  calibrationReportIdentity,
  type GatePolicyV2,
  gatePolicyIdentityV2,
  type IdentityOutcome,
  identityOf,
  instrumentRepetitions,
  type Rate,
  type ValidationIssue,
  type ValidationResult,
  validateAnyDefinition,
  validateAnyInstrument,
  validateCalibrationArtifactV2,
  validateCalibrationDataset,
  validateCalibrationReport,
  validateGatePolicyForV2,
  validateGatePolicyV2,
  validateVerdictEvidence,
  wilsonInterval,
} from "@lorelum/judge-protocol";

export const DEFAULT_CALIBRATION_REPETITIONS = 3;
const requiredCaseKinds = ["decisive", "equivalent", "anti"] as const;

export interface DefaultScope {
  readonly taskClass: string;
  readonly evidenceShape: string;
  readonly criterionIds: readonly string[];
}

export interface DefaultPolicyInput {
  readonly id: string;
  readonly definition: unknown;
  readonly instrument: unknown;
  readonly scopes: readonly DefaultScope[];
}

export function createDefaultGatePolicyV2(
  input: DefaultPolicyInput,
): ValidationResult<GatePolicyV2> {
  const definition = validateAnyDefinition(input.definition);
  const instrument = validateAnyInstrument(input.instrument);
  if (!definition.ok || !instrument.ok) {
    return {
      ok: false,
      issues: [
        ...(!definition.ok ? definition.issues : []),
        ...(!instrument.ok ? instrument.issues : []),
      ],
    };
  }
  if (instrumentRepetitions(instrument.value) !== DEFAULT_CALIBRATION_REPETITIONS) {
    return {
      ok: false,
      issues: [
        {
          path: "$.instrument.repetitions",
          code: "report_mismatch",
          message: `default policy requires ${DEFAULT_CALIBRATION_REPETITIONS} repetitions`,
        },
      ],
    };
  }
  const definitionId = anyDefinitionIdentity(definition.value);
  const instrumentId = anyInstrumentIdentity(instrument.value);
  if (!definitionId.ok || !instrumentId.ok) {
    return {
      ok: false,
      issues: [
        ...(!definitionId.ok ? definitionId.issues : []),
        ...(!instrumentId.ok ? instrumentId.issues : []),
      ],
    };
  }
  const criteria = definition.value.criteria.map((criterion) => ({
    criterionId: criterion.id,
    acceptedVerdicts: defaultAcceptedVerdicts(criterion),
    requiredCaseKinds,
  }));
  const policy: GatePolicyV2 = {
    schema: "lorelum.judge.gate-policy/v2",
    id: input.id,
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
    scopes: input.scopes.map((scope) => ({
      taskClass: scope.taskClass,
      evidenceShape: scope.evidenceShape,
      criterionIds: [...scope.criterionIds],
    })) as GatePolicyV2["scopes"],
    criteria: criteria as unknown as GatePolicyV2["criteria"],
    minimumAgreement: 2 / 3,
    minimumGroupsPerCaseKind: 20,
    confidenceLevel: 0.95,
    maximumFalseAcceptRate: 0.05,
    maximumFalseRejectRate: 0.1,
    maximumAbstentionRate: 0.2,
    maximumDisagreementRate: 0.2,
    onUncalibrated: "shadow",
  };
  return validateGatePolicyForV2(policy, definition.value, instrument.value);
}

function defaultAcceptedVerdicts(criterion: Criterion): Verdict["verdict"][] {
  if (criterion.kind === "contract") return ["met"];
  if (criterion.kind === "quality") return ["strong", "adequate"];
  return ["better", "equivalent"];
}

export interface BuildCalibrationInput {
  readonly dataset: unknown;
  readonly definition: unknown;
  readonly instrument: unknown;
  readonly policy: unknown;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface CalibrationPackage {
  readonly report: CalibrationReport;
  readonly artifacts: readonly CalibrationArtifactV2[];
}

export type BuildCalibrationResult =
  | { readonly ok: true; readonly value: CalibrationPackage }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

interface CaseResult {
  readonly prediction: Verdict["verdict"] | undefined;
  readonly disagreement: boolean;
  readonly failureCategories: readonly string[];
}

function rate(
  numerator: number,
  denominator: number,
  confidence: GatePolicyV2["confidenceLevel"],
): Rate {
  if (denominator === 0) return { numerator, denominator };
  const estimate = numerator / denominator;
  const [lowerBound, upperBound] = wilsonInterval(numerator, denominator, confidence);
  return { numerator, denominator, estimate, lowerBound, upperBound };
}

function evaluateCase(
  item: CalibrationCase,
  criterion: Criterion,
  repetitions: number,
  minimumAgreement: number,
): CaseResult {
  const verdicts: Verdict["verdict"][] = [];
  const failures: string[] = [];
  for (const observation of item.observations) {
    if (observation.status === "failed") {
      failures.push(observation.failureCategory);
      continue;
    }
    const verdict = observation.run.verdicts.find(
      (entry) => entry.criterionId === item.criterionId,
    );
    if (verdict === undefined) continue;
    const supported = validateVerdictEvidence(criterion, verdict, observation.evidenceBundle);
    if (!supported.ok) {
      failures.push("evidence");
      continue;
    }
    verdicts.push(verdict.verdict);
  }
  const aggregate = aggregateVerdicts(criterion.kind, verdicts, repetitions, minimumAgreement);
  return {
    prediction: aggregate.prediction,
    disagreement: aggregate.disagreement,
    failureCategories: failures,
  };
}

export function buildCalibration(input: BuildCalibrationInput): BuildCalibrationResult {
  const datasetResult = validateCalibrationDataset(
    input.dataset,
    input.definition,
    input.instrument,
    input.policy,
  );
  if (!datasetResult.ok) return datasetResult;
  const policyResult = validateGatePolicyV2(input.policy);
  const definitionResult = validateAnyDefinition(input.definition);
  const instrumentResult = validateAnyInstrument(input.instrument);
  if (!policyResult.ok || !definitionResult.ok || !instrumentResult.ok) {
    return {
      ok: false,
      issues: [
        ...(!policyResult.ok ? policyResult.issues : []),
        ...(!definitionResult.ok ? definitionResult.issues : []),
        ...(!instrumentResult.ok ? instrumentResult.issues : []),
      ],
    };
  }
  if (
    !Number.isFinite(Date.parse(input.validFrom)) ||
    !Number.isFinite(Date.parse(input.validUntil)) ||
    Date.parse(input.validFrom) >= Date.parse(input.validUntil)
  ) {
    return {
      ok: false,
      issues: [
        { path: "$.validUntil", code: "schema", message: "validUntil must be after validFrom" },
      ],
    };
  }

  const datasetId = calibrationDatasetIdentity(datasetResult.value);
  const policyId = gatePolicyIdentityV2(policyResult.value);
  const definitionId = anyDefinitionIdentity(definitionResult.value);
  const instrumentId = anyInstrumentIdentity(instrumentResult.value);
  if (!datasetId.ok) return datasetId;
  if (!policyId.ok) return policyId;
  if (!definitionId.ok) return definitionId;
  if (!instrumentId.ok) return instrumentId;
  const datasetIdentity = datasetId.identity;
  const policyIdentity = policyId.identity;
  const definitionIdentityValue = definitionId.identity;
  const instrumentIdentityValue = instrumentId.identity;
  const criteria = new Map(
    definitionResult.value.criteria.map((criterion) => [criterion.id, criterion]),
  );
  const rules = new Map(policyResult.value.criteria.map((rule) => [rule.criterionId, rule]));
  const reportScopes: CalibrationReport["scopes"][number][] = [];

  for (const scope of policyResult.value.scopes) {
    const groups = datasetResult.value.taskGroups.filter(
      (group) =>
        group.split === "holdout" &&
        group.taskClass === scope.taskClass &&
        group.evidenceShape === scope.evidenceShape,
    );
    for (const criterionId of scope.criterionIds) {
      const criterion = criteria.get(criterionId);
      const rule = rules.get(criterionId);
      if (criterion === undefined || rule === undefined) continue;
      const reasons = new Set<CalibrationReport["scopes"][number]["reasons"][number]>();
      const caseCounts: Record<string, number> = {};
      const failureCounts: Record<string, number> = {};
      const groupResults: Array<{
        readonly expectedAccepts: boolean[];
        readonly predictions: Array<boolean | undefined>;
        readonly disagreement: boolean;
      }> = [];
      let cases = 0;
      let observations = 0;
      for (const group of groups) {
        const groupCases = group.cases.filter((item) => item.criterionId === criterionId);
        const kinds = new Set(groupCases.map((item) => item.caseKind));
        for (const kind of kinds) caseCounts[kind] = (caseCounts[kind] ?? 0) + 1;
        const expectedAccepts: boolean[] = [];
        const predictions: Array<boolean | undefined> = [];
        let disagreement = false;
        const groupFailures = new Set<string>();
        for (const item of groupCases) {
          cases += 1;
          observations += item.observations.length;
          const result = evaluateCase(
            item,
            criterion,
            instrumentRepetitions(instrumentResult.value),
            policyResult.value.minimumAgreement,
          );
          for (const category of result.failureCategories) groupFailures.add(category);
          const accepted = new Set<string>(rule.acceptedVerdicts);
          expectedAccepts.push(accepted.has(item.expectedVerdict));
          predictions.push(
            result.prediction === undefined ? undefined : accepted.has(result.prediction),
          );
          disagreement ||= result.disagreement;
        }
        for (const category of groupFailures)
          failureCounts[category] = (failureCounts[category] ?? 0) + 1;
        groupResults.push({ expectedAccepts, predictions, disagreement });
      }

      for (const kind of rule.requiredCaseKinds) {
        if ((caseCounts[kind] ?? 0) < policyResult.value.minimumGroupsPerCaseKind)
          reasons.add("insufficient_coverage");
      }
      let falseAcceptNumerator = 0;
      let falseAcceptDenominator = 0;
      let falseRejectNumerator = 0;
      let falseRejectDenominator = 0;
      let abstentionNumerator = 0;
      let disagreementNumerator = 0;
      for (const group of groupResults) {
        const hasAcceptable = group.expectedAccepts.includes(true);
        const hasUnacceptable = group.expectedAccepts.includes(false);
        if (hasAcceptable) falseRejectDenominator += 1;
        if (hasUnacceptable) falseAcceptDenominator += 1;
        if (
          hasUnacceptable &&
          group.predictions.some(
            (prediction, index) => group.expectedAccepts[index] === false && prediction === true,
          )
        )
          falseAcceptNumerator += 1;
        if (
          hasAcceptable &&
          group.predictions.some(
            (prediction, index) => group.expectedAccepts[index] === true && prediction === false,
          )
        )
          falseRejectNumerator += 1;
        if (group.predictions.some((prediction) => prediction === undefined))
          abstentionNumerator += 1;
        if (group.disagreement) disagreementNumerator += 1;
      }
      const falseAccept = rate(
        falseAcceptNumerator,
        falseAcceptDenominator,
        policyResult.value.confidenceLevel,
      );
      const falseReject = rate(
        falseRejectNumerator,
        falseRejectDenominator,
        policyResult.value.confidenceLevel,
      );
      const abstention = rate(
        abstentionNumerator,
        groups.length,
        policyResult.value.confidenceLevel,
      );
      const disagreement = rate(
        disagreementNumerator,
        groups.length,
        policyResult.value.confidenceLevel,
      );
      const thresholds = [
        [falseAccept, policyResult.value.maximumFalseAcceptRate, "false_accept_threshold"],
        [falseReject, policyResult.value.maximumFalseRejectRate, "false_reject_threshold"],
        [abstention, policyResult.value.maximumAbstentionRate, "abstention_threshold"],
        [disagreement, policyResult.value.maximumDisagreementRate, "disagreement_threshold"],
      ] as const;
      for (const [metric, maximum, reason] of thresholds) {
        if (metric.denominator === 0) reasons.add("missing_denominator");
        else if ((metric.upperBound ?? 1) > maximum) reasons.add(reason);
      }
      reportScopes.push({
        taskClass: scope.taskClass,
        evidenceShape: scope.evidenceShape,
        criterionId,
        taskGroups: groups.length,
        cases,
        observations,
        caseCounts,
        failureCounts,
        falseAccept,
        falseReject,
        abstention,
        disagreement,
        eligible: reasons.size === 0,
        reasons: [...reasons],
      });
    }
  }

  const report: CalibrationReport = {
    schema: "lorelum.judge.calibration-report/v1",
    datasetIdentity,
    policyIdentity,
    definitionIdentity: definitionIdentityValue,
    instrumentIdentity: instrumentIdentityValue,
    confidenceLevel: policyResult.value.confidenceLevel,
    scopes: reportScopes as CalibrationReport["scopes"],
  };
  const checkedReport = validateCalibrationReport(report);
  if (!checkedReport.ok) return checkedReport;
  const reportId = calibrationReportIdentity(checkedReport.value);
  if (!reportId.ok) return reportId;
  const artifacts: CalibrationArtifactV2[] = [];
  for (const scope of policyResult.value.scopes) {
    const scopeIdentity = identityOf("lorelum.judge.calibration-scope/v1", scope);
    if (!scopeIdentity.ok)
      return {
        ok: false,
        issues: [
          { path: scopeIdentity.error.path, code: "schema", message: scopeIdentity.error.reason },
        ],
      };
    const artifact = {
      schema: "lorelum.judge.calibration-artifact/v2",
      id: `${policyResult.value.id}:${scope.taskClass}:${scope.evidenceShape}`,
      definitionIdentity: definitionIdentityValue,
      instrumentIdentity: instrumentIdentityValue,
      datasetIdentity,
      policyIdentity,
      reportIdentity: reportId.identity,
      scope,
      scopeIdentity: scopeIdentity.identity,
      status: "shadow",
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    } satisfies CalibrationArtifactV2;
    const checkedArtifact = validateCalibrationArtifactV2(artifact);
    if (!checkedArtifact.ok) return checkedArtifact;
    artifacts.push(checkedArtifact.value);
  }
  return { ok: true, value: { report: checkedReport.value, artifacts } };
}

export interface LoadCalibrationInput extends BuildCalibrationInput {
  readonly report: unknown;
  readonly artifact: unknown;
}

export interface VerifiedCalibration {
  readonly artifact: CalibrationArtifactV2;
  readonly report: CalibrationReport;
  readonly policy: GatePolicyV2;
  readonly definitionIdentity: string;
  readonly instrumentIdentity: string;
}

const verifiedCalibrations = new WeakSet<object>();

function freezeJson<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

function sameRecordIdentity(schema: string, left: unknown, right: unknown): boolean {
  const leftIdentity = identityOf(schema, left);
  const rightIdentity = identityOf(schema, right);
  return leftIdentity.ok && rightIdentity.ok && leftIdentity.identity === rightIdentity.identity;
}

export function loadVerifiedCalibration(
  input: LoadCalibrationInput,
): ValidationResult<VerifiedCalibration> {
  const built = buildCalibration(input);
  if (!built.ok) return built;
  const report = validateCalibrationReport(input.report);
  const artifact = validateCalibrationArtifactV2(input.artifact);
  const policy = validateGatePolicyV2(input.policy);
  if (!report.ok || !artifact.ok || !policy.ok) {
    return {
      ok: false,
      issues: [
        ...(!report.ok ? report.issues : []),
        ...(!artifact.ok ? artifact.issues : []),
        ...(!policy.ok ? policy.issues : []),
      ],
    };
  }
  const reportMatches = sameRecordIdentity(report.value.schema, report.value, built.value.report);
  const scopeIdentity = identityOf("lorelum.judge.calibration-scope/v1", artifact.value.scope);
  const expectedArtifact = built.value.artifacts.find(
    (candidate) => candidate.scopeIdentity === artifact.value.scopeIdentity,
  );
  if (!reportMatches || !scopeIdentity.ok || expectedArtifact === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "report_mismatch",
          message: "calibration report or scope does not match its source data",
        },
      ],
    };
  }
  const actual = artifact.value;
  const expected = expectedArtifact;
  const boundFieldsMatch =
    actual.scopeIdentity === scopeIdentity.identity &&
    actual.id === expected.id &&
    actual.definitionIdentity === expected.definitionIdentity &&
    actual.instrumentIdentity === expected.instrumentIdentity &&
    actual.datasetIdentity === expected.datasetIdentity &&
    actual.policyIdentity === expected.policyIdentity &&
    actual.reportIdentity === expected.reportIdentity &&
    actual.validFrom === expected.validFrom &&
    actual.validUntil === expected.validUntil &&
    sameRecordIdentity("lorelum.judge.calibration-scope/v1", actual.scope, expected.scope);
  if (!boundFieldsMatch) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "identity_mismatch",
          message: "calibration artifact is not bound to the recomputed report",
        },
      ],
    };
  }
  const scopeMetrics = built.value.report.scopes.filter(
    (entry) =>
      entry.taskClass === actual.scope.taskClass &&
      entry.evidenceShape === actual.scope.evidenceShape &&
      actual.scope.criterionIds.includes(entry.criterionId),
  );
  if (scopeMetrics.length !== actual.scope.criterionIds.length) {
    return {
      ok: false,
      issues: [
        {
          path: "$.scope",
          code: "invalid_applicability",
          message: "calibration scope is not covered by its report",
        },
      ],
    };
  }
  if (actual.status === "enforced" && scopeMetrics.some((entry) => !entry.eligible)) {
    return {
      ok: false,
      issues: [
        {
          path: "$.status",
          code: "report_mismatch",
          message: "ineligible calibration cannot be enforced",
        },
      ],
    };
  }
  const definitionId = anyDefinitionIdentity(input.definition);
  const instrumentId = anyInstrumentIdentity(input.instrument);
  if (!definitionId.ok || !instrumentId.ok) {
    return {
      ok: false,
      issues: [
        ...(!definitionId.ok ? definitionId.issues : []),
        ...(!instrumentId.ok ? instrumentId.issues : []),
      ],
    };
  }
  const verified = freezeJson({
    artifact: actual,
    report: built.value.report,
    policy: policy.value,
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
  }) as VerifiedCalibration;
  verifiedCalibrations.add(verified);
  return { ok: true, value: verified };
}

export function isVerifiedCalibration(value: unknown): value is VerifiedCalibration {
  return typeof value === "object" && value !== null && verifiedCalibrations.has(value);
}

export function calibrationScopeIdentity(scope: GatePolicyV2["scopes"][number]): IdentityOutcome {
  const result = identityOf("lorelum.judge.calibration-scope/v1", scope);
  return result.ok
    ? result
    : {
        ok: false,
        issues: [{ path: result.error.path, code: "schema", message: result.error.reason }],
      };
}
