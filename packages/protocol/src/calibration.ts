import type { ValidateFunction } from "ajv";
import { decisiveVerdicts } from "./criterion.js";
import { validateEvidenceBundle, validateVerdictEvidence } from "./evidence.js";
import type { CalibrationArtifactV2 } from "./generated/calibration-artifact-v2.js";
import type { CalibrationDataset } from "./generated/calibration-dataset.js";
import type { CalibrationReport, Rate } from "./generated/calibration-report.js";
import type { GateDecision } from "./generated/gate-decision.js";
import type { GatePolicyV2 } from "./generated/gate-policy-v2.js";
import { identityOf } from "./identity.js";
import type { IdentityOutcome } from "./measurement.js";
import { wilsonInterval } from "./measurement-aggregation.js";
import {
  anyDefinitionIdentity,
  anyInstrumentIdentity,
  instrumentRepetitions,
  isRequiredCriterion,
  validateAnyDefinition,
  validateAnyInstrument,
  validateAnyRun,
} from "./measurement-v2.js";
import artifactSchema from "./schemas/calibration-artifact-v2.schema.json" with { type: "json" };
import datasetSchema from "./schemas/calibration-dataset.schema.json" with { type: "json" };
import reportSchema from "./schemas/calibration-report.schema.json" with { type: "json" };
import decisionSchema from "./schemas/gate-decision.schema.json" with { type: "json" };
import policySchema from "./schemas/gate-policy-v2.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type {
  CalibrationArtifactV2,
  CalibrationDataset,
  CalibrationReport,
  GateDecision,
  GatePolicyV2,
  Rate,
};
export type CalibrationGroup = CalibrationDataset["taskGroups"][number];
export type CalibrationCase = CalibrationGroup["cases"][number];
export type CalibrationObservation = CalibrationCase["observations"][number];

const checkDataset = compileSchema<CalibrationDataset>(datasetSchema);
const checkPolicy = compileSchema<GatePolicyV2>(policySchema);
const checkReport = compileSchema<CalibrationReport>(reportSchema);
const checkArtifact = compileSchema<CalibrationArtifactV2>(artifactSchema);
const checkDecision = compileSchema<GateDecision>(decisionSchema);

function simple<T>(raw: unknown, check: ValidateFunction<T>): ValidationResult<T> {
  return guarded<ValidationResult<T>>(() => {
    const input = snapshot(raw);
    return check(input)
      ? { ok: true, value: input }
      : { ok: false, issues: schemaIssues(check.errors) };
  }, failed);
}

function identify<T extends { readonly schema: string }>(
  input: unknown,
  validate: (value: unknown) => ValidationResult<T>,
): IdentityOutcome {
  const result = validate(input);
  if (!result.ok) return result;
  const identity = identityOf(result.value.schema, result.value);
  return identity.ok
    ? identity
    : {
        ok: false,
        issues: [{ path: identity.error.path, code: "schema", message: identity.error.reason }],
      };
}

export function validateGatePolicyV2(raw: unknown): ValidationResult<GatePolicyV2> {
  return simple(raw, checkPolicy);
}

export function validateGatePolicyForV2(
  raw: unknown,
  definitionInput: unknown,
  instrumentInput: unknown,
): ValidationResult<GatePolicyV2> {
  return guarded<ValidationResult<GatePolicyV2>>(() => {
    const policy = validateGatePolicyV2(raw);
    const definition = validateAnyDefinition(definitionInput);
    const instrument = validateAnyInstrument(instrumentInput);
    const issues: ValidationIssue[] = [];
    if (!policy.ok) issues.push(...policy.issues);
    if (!definition.ok) issues.push(...definition.issues);
    if (!instrument.ok) issues.push(...instrument.issues);
    if (!policy.ok || !definition.ok || !instrument.ok) return { ok: false, issues };

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
    if (
      policy.value.definitionIdentity !== definitionId.identity ||
      policy.value.instrumentIdentity !== instrumentId.identity
    ) {
      issues.push({
        path: "$.definitionIdentity",
        code: "identity_mismatch",
        message: "gate policy does not match the definition and instrument",
      });
    }
    const criteria = new Map(
      definition.value.criteria.map((criterion) => [criterion.id, criterion]),
    );
    const rules = new Map(policy.value.criteria.map((rule) => [rule.criterionId, rule]));
    if (rules.size !== policy.value.criteria.length) {
      issues.push({
        path: "$.criteria",
        code: "duplicate_criterion",
        message: "gate policy has duplicate criteria",
      });
    }
    for (const [index, rule] of policy.value.criteria.entries()) {
      const criterion = criteria.get(rule.criterionId);
      if (criterion === undefined) {
        issues.push({
          path: `$.criteria[${index}].criterionId`,
          code: "unknown_criterion",
          message: `unknown criterion "${rule.criterionId}"`,
        });
        continue;
      }
      if (
        criterion.kind === "contract" &&
        isRequiredCriterion(definition.value, criterion.id) &&
        (rule.acceptedVerdicts.length !== 1 || rule.acceptedVerdicts[0] !== "met")
      ) {
        issues.push({
          path: `$.criteria[${index}].acceptedVerdicts`,
          code: "verdict_not_allowed",
          message: "a mandatory contract criterion accepts only met",
        });
      }
      for (const verdict of rule.acceptedVerdicts) {
        if (!decisiveVerdicts[criterion.kind].includes(verdict)) {
          issues.push({
            path: `$.criteria[${index}].acceptedVerdicts`,
            code: "verdict_not_allowed",
            message: `"${verdict}" is not decisive for ${criterion.kind}`,
          });
        }
      }
      const kinds = new Set(rule.requiredCaseKinds);
      if (
        !kinds.has("decisive") ||
        !kinds.has("equivalent") ||
        (!kinds.has("anti") && !kinds.has("partial"))
      ) {
        issues.push({
          path: `$.criteria[${index}].requiredCaseKinds`,
          code: "invalid_applicability",
          message: "policy requires decisive, equivalent, and anti or partial cases",
        });
      }
    }
    const scopeKeys = new Set<string>();
    const covered = new Set<string>();
    for (const [index, scope] of policy.value.scopes.entries()) {
      const key = `${scope.taskClass}\0${scope.evidenceShape}`;
      if (scopeKeys.has(key))
        issues.push({
          path: `$.scopes[${index}]`,
          code: "invalid_applicability",
          message: "duplicate task-class/evidence-shape scope",
        });
      scopeKeys.add(key);
      for (const criterionId of scope.criterionIds) {
        if (!criteria.has(criterionId) || !rules.has(criterionId)) {
          issues.push({
            path: `$.scopes[${index}].criterionIds`,
            code: "unknown_criterion",
            message: `criterion "${criterionId}" has no definition or policy`,
          });
        }
        covered.add(criterionId);
      }
      for (const criterion of definition.value.criteria) {
        if (
          isRequiredCriterion(definition.value, criterion.id) &&
          !scope.criterionIds.includes(criterion.id)
        ) {
          issues.push({
            path: `$.scopes[${index}].criterionIds`,
            code: "invalid_applicability",
            message: `scope omits mandatory criterion "${criterion.id}"`,
          });
        }
      }
    }
    for (const criterionId of rules.keys()) {
      if (!covered.has(criterionId))
        issues.push({
          path: "$.criteria",
          code: "invalid_applicability",
          message: `criterion "${criterionId}" is not used by a scope`,
        });
    }
    return issues.length === 0 ? policy : { ok: false, issues };
  }, failed);
}

export function validateCalibrationDataset(
  raw: unknown,
  definitionInput: unknown,
  instrumentInput: unknown,
  policyInput: unknown,
): ValidationResult<CalibrationDataset> {
  return guarded<ValidationResult<CalibrationDataset>>(() => {
    const dataset = simple(raw, checkDataset);
    const definition = validateAnyDefinition(definitionInput);
    const instrument = validateAnyInstrument(instrumentInput);
    const policy = validateGatePolicyForV2(policyInput, definitionInput, instrumentInput);
    const issues: ValidationIssue[] = [];
    if (!dataset.ok) issues.push(...dataset.issues);
    if (!definition.ok) issues.push(...definition.issues);
    if (!instrument.ok) issues.push(...instrument.issues);
    if (!policy.ok) issues.push(...policy.issues);
    if (!dataset.ok || !definition.ok || !instrument.ok || !policy.ok) return { ok: false, issues };

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
    if (
      dataset.value.definitionIdentity !== definitionId.identity ||
      dataset.value.instrumentIdentity !== instrumentId.identity
    ) {
      issues.push({
        path: "$.definitionIdentity",
        code: "identity_mismatch",
        message: "dataset does not match the definition and instrument",
      });
    }

    const criteria = new Map(
      definition.value.criteria.map((criterion) => [criterion.id, criterion]),
    );
    const rules = new Map(policy.value.criteria.map((rule) => [rule.criterionId, rule]));
    const scopes = new Map(
      policy.value.scopes.map((scope) => [`${scope.taskClass}\0${scope.evidenceShape}`, scope]),
    );
    const groupIds = new Set<string>();
    const taskIdentities = new Set<string>();
    const runTaskGroups = new Map<string, string>();
    for (const [groupIndex, group] of dataset.value.taskGroups.entries()) {
      const groupPath = `$.taskGroups[${groupIndex}]`;
      if (groupIds.has(group.id))
        issues.push({
          path: `${groupPath}.id`,
          code: "duplicate_acceptance",
          message: `task group "${group.id}" appears more than once`,
        });
      groupIds.add(group.id);
      if (taskIdentities.has(group.taskIdentity))
        issues.push({
          path: `${groupPath}.taskIdentity`,
          code: "duplicate_acceptance",
          message:
            "the same underlying task must have all variants in one task group and one split",
        });
      taskIdentities.add(group.taskIdentity);
      const scope = scopes.get(`${group.taskClass}\0${group.evidenceShape}`);
      if (group.split === "holdout" && scope === undefined) {
        issues.push({
          path: `${groupPath}.taskClass`,
          code: "invalid_applicability",
          message: "holdout group is outside declared policy scopes",
        });
      }
      const caseIds = new Set<string>();
      const observationIds = new Set<string>();
      const evidenceIds = new Set<string>();
      const labeledCriteria = new Set<string>();
      for (const [caseIndex, item] of group.cases.entries()) {
        const itemPath = `${groupPath}.cases[${caseIndex}]`;
        if (caseIds.has(item.id))
          issues.push({
            path: `${itemPath}.id`,
            code: "duplicate_acceptance",
            message: `duplicate case "${item.id}"`,
          });
        caseIds.add(item.id);
        const criterion = criteria.get(item.criterionId);
        const rule = rules.get(item.criterionId);
        if (criterion === undefined || rule === undefined) {
          issues.push({
            path: `${itemPath}.criterionId`,
            code: "unknown_criterion",
            message: `unknown criterion "${item.criterionId}"`,
          });
          continue;
        }
        labeledCriteria.add(item.criterionId);
        if (!decisiveVerdicts[criterion.kind].includes(item.expectedVerdict)) {
          issues.push({
            path: `${itemPath}.expectedVerdict`,
            code: "verdict_not_allowed",
            message: `expected verdict is not decisive for ${criterion.kind}`,
          });
        }
        if (!rule.requiredCaseKinds.includes(item.caseKind)) {
          issues.push({
            path: `${itemPath}.caseKind`,
            code: "invalid_applicability",
            message: "case kind is not required by policy",
          });
        }
        if (
          item.caseKind === "equivalent" &&
          criterion.kind === "contract" &&
          item.expectedVerdict !== "met"
        ) {
          issues.push({
            path: `${itemPath}.expectedVerdict`,
            code: "verdict_not_allowed",
            message: "equivalent contract behavior must be labeled met",
          });
        }
        if (
          item.caseKind === "equivalent" &&
          criterion.kind === "comparison" &&
          item.expectedVerdict !== "equivalent"
        ) {
          issues.push({
            path: `${itemPath}.expectedVerdict`,
            code: "verdict_not_allowed",
            message: "equivalent comparison case must be labeled equivalent",
          });
        }
        if (
          (item.caseKind === "anti" || item.caseKind === "partial") &&
          rule.acceptedVerdicts.includes(item.expectedVerdict)
        ) {
          issues.push({
            path: `${itemPath}.expectedVerdict`,
            code: "verdict_not_allowed",
            message: "anti/partial cases must be unacceptable under the gate policy",
          });
        }
        if (scope !== undefined && !scope.criterionIds.includes(item.criterionId)) {
          issues.push({
            path: `${itemPath}.criterionId`,
            code: "invalid_applicability",
            message: "criterion is outside this scope",
          });
        }
        if (item.observations.length !== instrumentRepetitions(instrument.value)) {
          issues.push({
            path: `${itemPath}.observations`,
            code: "report_mismatch",
            message: `expected ${instrumentRepetitions(instrument.value)} observations`,
          });
        }
        const runIds = new Set<string>();
        for (const [observationIndex, observation] of item.observations.entries()) {
          const observationPath = `${itemPath}.observations[${observationIndex}]`;
          if (observationIds.has(observation.id))
            issues.push({
              path: `${observationPath}.id`,
              code: "duplicate_verdict",
              message: "duplicate observation id",
            });
          observationIds.add(observation.id);
          if (observation.status === "failed") {
            if (observation.evidenceBundle !== undefined) {
              const bundle = validateEvidenceBundle(observation.evidenceBundle);
              if (!bundle.ok) {
                issues.push(
                  ...bundle.issues.map((issue) => ({
                    ...issue,
                    path: `${observationPath}.evidenceBundle${issue.path.slice(1)}`,
                  })),
                );
              } else {
                for (const id of bundle.value.items.map((entry) => entry.id)) evidenceIds.add(id);
              }
            }
            continue;
          }
          const run = validateAnyRun(definition.value, instrument.value, observation.run);
          const bundle = validateEvidenceBundle(observation.evidenceBundle);
          if (run.ok) {
            const owningGroup = runTaskGroups.get(run.value.id);
            if (owningGroup !== undefined && owningGroup !== group.id)
              issues.push({
                path: `${observationPath}.run.id`,
                code: "duplicate_verdict",
                message: "the same measurement run cannot be counted in multiple task groups",
              });
            else runTaskGroups.set(run.value.id, group.id);
            if (runIds.has(run.value.id))
              issues.push({
                path: `${observationPath}.run.id`,
                code: "duplicate_verdict",
                message:
                  "the same measurement run cannot count as multiple repetitions of one case",
              });
            runIds.add(run.value.id);
          }
          if (!run.ok)
            issues.push(
              ...run.issues.map((issue) => ({
                ...issue,
                path: `${observationPath}.run${issue.path.slice(1)}`,
              })),
            );
          if (!bundle.ok) {
            issues.push(
              ...bundle.issues.map((issue) => ({
                ...issue,
                path: `${observationPath}.evidenceBundle${issue.path.slice(1)}`,
              })),
            );
            continue;
          }
          if (!run.ok) continue;
          const byId = new Map(run.value.verdicts.map((verdict) => [verdict.criterionId, verdict]));
          for (const [criterionId, verdict] of byId) {
            const owner = criteria.get(criterionId);
            if (owner === undefined) continue;
            const checked = validateVerdictEvidence(owner, verdict, bundle.value);
            if (!checked.ok) {
              issues.push(
                ...checked.issues
                  .filter((issue) => issue.code !== "verdict_unsupported")
                  .map((issue) => ({
                    ...issue,
                    path: `${observationPath}.run.verdicts.${criterionId}${issue.path.slice(1)}`,
                  })),
              );
            }
          }
          for (const id of bundle.value.items.map((entry) => entry.id)) evidenceIds.add(id);
        }
      }
      if (group.split === "holdout" && scope !== undefined) {
        for (const criterionId of scope.criterionIds) {
          if (!labeledCriteria.has(criterionId)) {
            issues.push({
              path: `${groupPath}.cases`,
              code: "missing_verdict",
              message: `holdout task group has no case for criterion "${criterionId}"`,
            });
          }
        }
      }
      for (const [caseIndex, item] of group.cases.entries()) {
        for (const id of item.evidenceIds) {
          if (!evidenceIds.has(id))
            issues.push({
              path: `${groupPath}.cases[${caseIndex}].evidenceIds`,
              code: "evidence_not_in_bundle",
              message: `label evidence "${id}" is not present in this task group`,
            });
        }
      }
    }
    return issues.length === 0 ? dataset : { ok: false, issues };
  }, failed);
}

export function validateCalibrationReport(raw: unknown): ValidationResult<CalibrationReport> {
  return guarded<ValidationResult<CalibrationReport>>(() => {
    const result = simple(raw, checkReport);
    if (!result.ok) return result;
    const issues: ValidationIssue[] = [];
    for (const [index, scope] of result.value.scopes.entries()) {
      let hasMissingDenominator = false;
      if (scope.cases < scope.taskGroups || scope.observations < scope.cases) {
        issues.push({
          path: `$.scopes[${index}]`,
          code: "report_mismatch",
          message: "case and observation counts cannot be lower than their parent counts",
        });
      }
      for (const [kind, count] of Object.entries(scope.caseCounts)) {
        if (count > scope.taskGroups) {
          issues.push({
            path: `$.scopes[${index}].caseCounts.${kind}`,
            code: "report_mismatch",
            message: "a case kind may be counted at most once per task group",
          });
        }
      }
      for (const name of ["falseAccept", "falseReject", "abstention", "disagreement"] as const) {
        const rate = scope[name];
        const path = `$.scopes[${index}].${name}`;
        if (rate.numerator > rate.denominator) {
          issues.push({ path, code: "report_mismatch", message: "numerator exceeds denominator" });
          continue;
        }
        if (rate.denominator === 0) {
          hasMissingDenominator = true;
          if (
            rate.numerator !== 0 ||
            rate.estimate !== undefined ||
            rate.lowerBound !== undefined ||
            rate.upperBound !== undefined
          ) {
            issues.push({
              path,
              code: "report_mismatch",
              message: "a zero denominator requires a zero numerator and no rate estimates",
            });
          }
          continue;
        }
        if (
          rate.denominator > scope.taskGroups ||
          ((name === "abstention" || name === "disagreement") &&
            rate.denominator !== scope.taskGroups)
        ) {
          issues.push({
            path,
            code: "report_mismatch",
            message: "rate denominator does not match the task-group counting rule",
          });
        }
        if (
          rate.estimate === undefined ||
          rate.lowerBound === undefined ||
          rate.upperBound === undefined
        ) {
          issues.push({
            path,
            code: "report_mismatch",
            message: "a non-zero denominator requires an estimate and confidence interval",
          });
          continue;
        }
        const estimate = rate.numerator / rate.denominator;
        const [lowerBound, upperBound] = wilsonInterval(
          rate.numerator,
          rate.denominator,
          result.value.confidenceLevel,
        );
        if (
          !close(rate.estimate, estimate) ||
          !close(rate.lowerBound, lowerBound) ||
          !close(rate.upperBound, upperBound)
        ) {
          issues.push({
            path,
            code: "report_mismatch",
            message: "rate estimate or Wilson interval does not match its counts",
          });
        }
      }
      if (scope.eligible !== (scope.reasons.length === 0)) {
        issues.push({
          path: `$.scopes[${index}].eligible`,
          code: "report_mismatch",
          message: "eligibility must agree with the reported reasons",
        });
      }
      if (hasMissingDenominator !== scope.reasons.includes("missing_denominator")) {
        issues.push({
          path: `$.scopes[${index}].reasons`,
          code: "report_mismatch",
          message: "missing_denominator reason must match the reported rates",
        });
      }
      for (const [category, count] of Object.entries(scope.failureCounts)) {
        if (count > scope.taskGroups) {
          issues.push({
            path: `$.scopes[${index}].failureCounts.${category}`,
            code: "report_mismatch",
            message: "a failure category may be counted at most once per task group",
          });
        }
      }
    }
    return issues.length === 0 ? result : { ok: false, issues };
  }, failed);
}

function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-12;
}

export function validateCalibrationArtifactV2(
  raw: unknown,
): ValidationResult<CalibrationArtifactV2> {
  return guarded<ValidationResult<CalibrationArtifactV2>>(() => {
    const result = simple(raw, checkArtifact);
    if (!result.ok) return result;
    const expected = identityOf("lorelum.judge.calibration-scope/v1", result.value.scope);
    if (!expected.ok || expected.identity !== result.value.scopeIdentity) {
      return {
        ok: false,
        issues: [
          {
            path: "$.scopeIdentity",
            code: "identity_mismatch",
            message: "scope identity does not match scope",
          },
        ],
      };
    }
    if (
      !Number.isFinite(Date.parse(result.value.validFrom)) ||
      !Number.isFinite(Date.parse(result.value.validUntil)) ||
      Date.parse(result.value.validFrom) >= Date.parse(result.value.validUntil)
    ) {
      return {
        ok: false,
        issues: [
          {
            path: "$.validUntil",
            code: "schema",
            message: "validity interval must be parseable and validUntil must be after validFrom",
          },
        ],
      };
    }
    return result;
  }, failed);
}

export function validateGateDecision(raw: unknown): ValidationResult<GateDecision> {
  return guarded<ValidationResult<GateDecision>>(() => {
    const result = simple(raw, checkDecision);
    if (!result.ok) return result;
    const issues: ValidationIssue[] = [];
    const criterionIds = new Set<string>();
    for (const [index, finding] of result.value.findings.entries()) {
      if (criterionIds.has(finding.criterionId)) {
        issues.push({
          path: `$.findings[${index}].criterionId`,
          code: "duplicate_criterion",
          message: `duplicate finding for criterion "${finding.criterionId}"`,
        });
      }
      criterionIds.add(finding.criterionId);
    }
    const noApplicableScope =
      result.value.findings.length > 0 &&
      result.value.findings.every((finding) => finding.reason === "not_applicable");
    const expectedOutcome: GateDecision["qualityOutcome"] = result.value.findings.some(
      (finding) => finding.outcome === "fail",
    )
      ? "fail"
      : result.value.findings.length === 0 ||
          noApplicableScope ||
          result.value.findings.some((finding) => finding.outcome === "indeterminate")
        ? "indeterminate"
        : "pass";
    if (result.value.qualityOutcome !== expectedOutcome) {
      issues.push({
        path: "$.qualityOutcome",
        code: "report_mismatch",
        message: "quality outcome does not match the criterion findings",
      });
    }
    return issues.length === 0 ? result : { ok: false, issues };
  }, failed);
}

export function calibrationDatasetIdentity(input: unknown): IdentityOutcome {
  return identify(input, (value) => simple(value, checkDataset));
}

export function gatePolicyIdentityV2(input: unknown): IdentityOutcome {
  return identify(input, validateGatePolicyV2);
}

export function calibrationReportIdentity(input: unknown): IdentityOutcome {
  return identify(input, validateCalibrationReport);
}

export function calibrationArtifactIdentityV2(input: unknown): IdentityOutcome {
  return identify(input, validateCalibrationArtifactV2);
}

export function gateDecisionIdentity(input: unknown): IdentityOutcome {
  return identify(input, validateGateDecision);
}
