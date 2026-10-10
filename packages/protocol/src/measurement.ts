import { validateCriteria, validateVerdict } from "./criterion.js";
import type { CalibrationArtifact } from "./generated/calibration-artifact.js";
import type { GatePolicy } from "./generated/gate-policy.js";
import type { InstrumentProfile } from "./generated/instrument-profile.js";
import type { MeasurementDefinition } from "./generated/measurement-definition.js";
import type { MeasurementRun } from "./generated/measurement-run.js";
import { type Identity, identityOf } from "./identity.js";
import type { JsonValue } from "./json.js";
import calibrationSchema from "./schemas/calibration-artifact.schema.json" with { type: "json" };
import gatePolicySchema from "./schemas/gate-policy.schema.json" with { type: "json" };
import instrumentSchema from "./schemas/instrument-profile.schema.json" with { type: "json" };
import definitionSchema from "./schemas/measurement-definition.schema.json" with { type: "json" };
import runSchema from "./schemas/measurement-run.schema.json" with { type: "json" };
import {
  compileSchema,
  schemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type {
  CalibrationArtifact,
  GatePolicy,
  InstrumentProfile,
  MeasurementDefinition,
  MeasurementRun,
};

export type IdentityOutcome =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const checkDefinition = compileSchema<MeasurementDefinition>(definitionSchema);
const checkInstrument = compileSchema<InstrumentProfile>(instrumentSchema);
const checkGatePolicy = compileSchema<GatePolicy>(gatePolicySchema);
const checkCalibration = compileSchema<CalibrationArtifact>(calibrationSchema);
const checkRun = compileSchema<MeasurementRun>(runSchema);

export function validateDefinition(input: unknown): ValidationResult<MeasurementDefinition> {
  if (!checkDefinition(input)) {
    return { ok: false, issues: schemaIssues(checkDefinition.errors) };
  }
  const criteria = validateCriteria(input.criteria);
  if (!criteria.ok) {
    return {
      ok: false,
      issues: criteria.issues.map((issue) => ({
        ...issue,
        path: `$.criteria${issue.path.slice(1)}`,
      })),
    };
  }
  return { ok: true, value: input };
}

export function validateInstrument(input: unknown): ValidationResult<InstrumentProfile> {
  return checkInstrument(input)
    ? { ok: true, value: input }
    : { ok: false, issues: schemaIssues(checkInstrument.errors) };
}

export function validateGatePolicy(input: unknown): ValidationResult<GatePolicy> {
  return checkGatePolicy(input)
    ? { ok: true, value: input }
    : { ok: false, issues: schemaIssues(checkGatePolicy.errors) };
}

export function validateCalibration(input: unknown): ValidationResult<CalibrationArtifact> {
  return checkCalibration(input)
    ? { ok: true, value: input }
    : { ok: false, issues: schemaIssues(checkCalibration.errors) };
}

function identityIssue(path: string, reason: string): readonly ValidationIssue[] {
  return [{ path, code: "schema", message: `identity: ${reason}` }];
}

function identify(validated: ValidationResult<{ readonly schema: string }>): IdentityOutcome {
  if (!validated.ok) {
    return validated;
  }
  const result = identityOf(validated.value.schema, validated.value as unknown as JsonValue);
  return result.ok
    ? result
    : { ok: false, issues: identityIssue(result.error.path, result.error.reason) };
}

export function definitionIdentity(input: unknown): IdentityOutcome {
  return identify(validateDefinition(input));
}

export function instrumentIdentity(input: unknown): IdentityOutcome {
  return identify(validateInstrument(input));
}

export function gatePolicyIdentity(input: unknown): IdentityOutcome {
  return identify(validateGatePolicy(input));
}

/**
 * Validates a run against the definition and instrument it claims to measure with.
 * Every criterion needs exactly one verdict; a missing verdict is never read as a
 * failure or a zero.
 */
export function validateRun(
  definitionInput: unknown,
  instrumentInput: unknown,
  input: unknown,
): ValidationResult<MeasurementRun> {
  const definition = validateDefinition(definitionInput);
  if (!definition.ok) {
    return {
      ok: false,
      issues: definition.issues.map((issue) => ({
        ...issue,
        path: `definition${issue.path.slice(1)}`,
      })),
    };
  }
  const instrument = validateInstrument(instrumentInput);
  if (!instrument.ok) {
    return {
      ok: false,
      issues: instrument.issues.map((issue) => ({
        ...issue,
        path: `instrument${issue.path.slice(1)}`,
      })),
    };
  }
  if (!checkRun(input)) {
    return { ok: false, issues: schemaIssues(checkRun.errors) };
  }

  const issues: ValidationIssue[] = [];
  const expectedDefinition = definitionIdentity(definition.value);
  const expectedInstrument = instrumentIdentity(instrument.value);

  if (expectedDefinition.ok && input.definitionIdentity !== expectedDefinition.identity) {
    issues.push({
      path: "$.definitionIdentity",
      code: "identity_mismatch",
      message: "run was not measured with this definition",
    });
  }
  if (expectedInstrument.ok && input.instrumentIdentity !== expectedInstrument.identity) {
    issues.push({
      path: "$.instrumentIdentity",
      code: "identity_mismatch",
      message: "run was not measured with this instrument",
    });
  }

  const criteria = new Map(definition.value.criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();

  for (const [index, verdict] of input.verdicts.entries()) {
    const criterion = criteria.get(verdict.criterionId);
    if (criterion === undefined) {
      issues.push({
        path: `$.verdicts[${index}].criterionId`,
        code: "unknown_criterion",
        message: `definition has no criterion "${verdict.criterionId}"`,
      });
      continue;
    }
    if (seen.has(verdict.criterionId)) {
      issues.push({
        path: `$.verdicts[${index}].criterionId`,
        code: "duplicate_verdict",
        message: `criterion "${verdict.criterionId}" has more than one verdict`,
      });
      continue;
    }
    seen.add(verdict.criterionId);

    const checked = validateVerdict(criterion, verdict);
    if (!checked.ok) {
      issues.push(
        ...checked.issues.map((issue) => ({
          ...issue,
          path: `$.verdicts[${index}]${issue.path.slice(1)}`,
        })),
      );
    }
  }

  for (const criterion of definition.value.criteria) {
    if (!seen.has(criterion.id)) {
      issues.push({
        path: "$.verdicts",
        code: "missing_verdict",
        message: `criterion "${criterion.id}" has no verdict`,
      });
    }
  }

  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}
