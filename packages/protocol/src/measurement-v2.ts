import { assessVerdicts } from "./assessment.js";
import { validateCriteria } from "./criterion.js";
import { evidenceBundleIdentity } from "./evidence.js";
import type { EvidenceItem } from "./generated/evidence-item.js";
import type { InstrumentProfile } from "./generated/instrument-profile.js";
import type { InstrumentProfileV2 } from "./generated/instrument-profile-v2.js";
import type { MeasurementDefinition } from "./generated/measurement-definition.js";
import type { MeasurementDefinitionV2 } from "./generated/measurement-definition-v2.js";
import type { MeasurementRun } from "./generated/measurement-run.js";
import type { MeasurementRunV2 } from "./generated/measurement-run-v2.js";
import type { ReviewExecution } from "./generated/review-execution.js";
import { identifyValidated, identityOf } from "./identity.js";
import {
  definitionIdentity,
  type IdentityOutcome,
  instrumentIdentity,
  validateDefinition,
  validateInstrument,
  validateRun,
} from "./measurement.js";
import { validateRubricSet } from "./rubric.js";
import instrumentV2Schema from "./schemas/instrument-profile-v2.schema.json" with { type: "json" };
import definitionV2Schema from "./schemas/measurement-definition-v2.schema.json" with {
  type: "json",
};
import runV2Schema from "./schemas/measurement-run-v2.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type { InstrumentProfileV2, MeasurementDefinitionV2, MeasurementRunV2, ReviewExecution };
export type AnyMeasurementDefinition = MeasurementDefinition | MeasurementDefinitionV2;
export type AnyInstrumentProfile = InstrumentProfile | InstrumentProfileV2;

const checkDefinitionV2 = compileSchema<MeasurementDefinitionV2>(definitionV2Schema);
const checkInstrumentV2 = compileSchema<InstrumentProfileV2>(instrumentV2Schema);
const checkRunV2 = compileSchema<MeasurementRunV2>(runV2Schema);

const DEFINITION_V1 = "lorelum.judge.measurement-definition/v1";
const DEFINITION_V2 = "lorelum.judge.measurement-definition/v2";
const INSTRUMENT_V1 = "lorelum.judge.instrument-profile/v1";

function schemaOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("schema" in raw)) {
    return undefined;
  }
  return raw.schema;
}

function metadataIssues(definition: MeasurementDefinitionV2): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const criteria = new Map(definition.criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  for (const [index, metadata] of definition.metadata.entries()) {
    if (!criteria.has(metadata.criterionId)) {
      issues.push({
        path: `$.metadata[${index}].criterionId`,
        code: "unknown_criterion",
        message: `definition has no criterion "${metadata.criterionId}"`,
      });
    }
    if (seen.has(metadata.criterionId)) {
      issues.push({
        path: `$.metadata[${index}].criterionId`,
        code: "duplicate_criterion",
        message: `criterion "${metadata.criterionId}" has more than one metadata record`,
      });
    }
    seen.add(metadata.criterionId);
  }
  for (const criterion of definition.criteria) {
    if (!seen.has(criterion.id)) {
      issues.push({
        path: "$.metadata",
        code: "schema",
        message: `criterion "${criterion.id}" has no metadata record`,
      });
    }
  }
  return issues;
}

export function validateMeasurementDefinitionV2(
  raw: unknown,
): ValidationResult<MeasurementDefinitionV2> {
  return guarded<ValidationResult<MeasurementDefinitionV2>>(() => {
    const input = snapshot(raw);
    if (!checkDefinitionV2(input)) {
      return { ok: false, issues: schemaIssues(checkDefinitionV2.errors) };
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
    const issues = [...metadataIssues(input)];
    const provenance = input.provenance;
    if (provenance !== undefined) {
      const rubric = [
        provenance.rubricId,
        provenance.rubricIdentity,
        provenance.contractIdentity,
      ].every((value) => value !== undefined);
      const migration =
        provenance.migratedFrom !== undefined && provenance.sourceIdentity !== undefined;
      if (rubric === migration) {
        issues.push({
          path: "$.provenance",
          code: "schema",
          message: "provenance must describe either a source rubric or a v1 migration, not both",
        });
      }
    }
    return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
  }, failed);
}

export function measurementDefinitionIdentityV2(input: unknown): IdentityOutcome {
  return identifyValidated(validateMeasurementDefinitionV2(input));
}

export function validateInstrumentV2(raw: unknown): ValidationResult<InstrumentProfileV2> {
  return guarded<ValidationResult<InstrumentProfileV2>>(() => {
    const input = snapshot(raw);
    if (!checkInstrumentV2(input)) {
      return { ok: false, issues: schemaIssues(checkInstrumentV2.errors) };
    }
    if (
      input.method.kind === "program" &&
      input.method.checker.version === undefined &&
      input.method.checker.contentIdentity === undefined
    ) {
      return {
        ok: false,
        issues: [
          {
            path: "$.method.checker",
            code: "schema",
            message: "name the checker version or content identity",
          },
        ],
      };
    }
    return { ok: true, value: input };
  }, failed);
}

export function instrumentIdentityV2(input: unknown): IdentityOutcome {
  return identifyValidated(validateInstrumentV2(input));
}

/**
 * Converts a frozen RubricSet into an executable MeasurementDefinition/v2. The
 * original criterion, including its mandatory flag, is copied verbatim; role,
 * covers and appliesTo are carried into metadata. A proposal is refused.
 */
export function frozenRubricToDefinition(
  raw: unknown,
  options: { readonly id?: string } = {},
): ValidationResult<MeasurementDefinitionV2> {
  return guarded<ValidationResult<MeasurementDefinitionV2>>(() => {
    const rubricInput = snapshot(raw);
    const rubric = validateRubricSet(rubricInput);
    if (!rubric.ok) {
      return rubric;
    }
    if (rubric.value.status !== "frozen") {
      return {
        ok: false,
        issues: [
          {
            path: "$.status",
            code: "invalid_applicability",
            message: "only a frozen rubric can be converted into an executable definition",
          },
        ],
      };
    }
    const rubricIdentity = identityOf(rubric.value.schema, rubric.value);
    if (!rubricIdentity.ok) {
      return {
        ok: false,
        issues: [
          {
            path: rubricIdentity.error.path,
            code: "schema",
            message: `identity: ${rubricIdentity.error.reason}`,
          },
        ],
      };
    }
    const candidate = {
      schema: DEFINITION_V2,
      id: options.id ?? rubric.value.id,
      criteria: rubric.value.entries.map((entry) => entry.criterion),
      metadata: rubric.value.entries.map((entry) => ({
        criterionId: entry.criterion.id,
        role: entry.role,
        covers: [...entry.covers],
        appliesTo: [...entry.appliesTo],
      })),
      provenance: {
        rubricId: rubric.value.id,
        rubricIdentity: rubricIdentity.identity,
        contractIdentity: rubric.value.contractIdentity,
      },
    };
    return validateMeasurementDefinitionV2(candidate);
  }, failed);
}

/**
 * Explicit v1-to-v2 migration. Roles default to `decisive` and the source identity
 * is recorded, so the new definition has a different identity from the v1 record.
 */
export function migrateDefinitionV1(raw: unknown): ValidationResult<MeasurementDefinitionV2> {
  return guarded<ValidationResult<MeasurementDefinitionV2>>(() => {
    const definition = validateDefinition(raw);
    if (!definition.ok) {
      return definition;
    }
    const sourceIdentity = identityOf(DEFINITION_V1, definition.value);
    if (!sourceIdentity.ok) {
      return {
        ok: false,
        issues: [
          {
            path: sourceIdentity.error.path,
            code: "schema",
            message: `identity: ${sourceIdentity.error.reason}`,
          },
        ],
      };
    }
    return validateMeasurementDefinitionV2({
      schema: DEFINITION_V2,
      id: definition.value.id,
      criteria: definition.value.criteria,
      metadata: definition.value.criteria.map((criterion) => ({
        criterionId: criterion.id,
        role: "decisive",
        covers: [],
        appliesTo: [],
      })),
      provenance: {
        migratedFrom: DEFINITION_V1,
        sourceIdentity: sourceIdentity.identity,
      },
    });
  }, failed);
}

/** True when a v2 advisory entry is non-blocking even if its criterion is mandatory. */
export function isRequiredCriterion(
  definition: AnyMeasurementDefinition,
  criterionId: string,
): boolean {
  if (definition.schema === DEFINITION_V1) {
    return definition.criteria.some(
      (criterion) => criterion.id === criterionId && criterion.mandatory,
    );
  }
  const metadata = definition.metadata.find((entry) => entry.criterionId === criterionId);
  const criterion = definition.criteria.find((entry) => entry.id === criterionId);
  return metadata?.role === "decisive" && criterion?.mandatory === true;
}

export function requiredCriterionIds(definition: AnyMeasurementDefinition): readonly string[] {
  return definition.criteria
    .filter((criterion) => isRequiredCriterion(definition, criterion.id))
    .map((criterion) => criterion.id);
}

export function instrumentRepetitions(instrument: AnyInstrumentProfile): number {
  return instrument.schema === INSTRUMENT_V1
    ? instrument.repetitions
    : instrument.method.repetitions;
}

export function validateMeasurementRunV2(
  definitionInput: unknown,
  instrumentInput: unknown,
  raw: unknown,
): ValidationResult<MeasurementRunV2> {
  return guarded<ValidationResult<MeasurementRunV2>>(
    () => checkRunAgainstV2(definitionInput, instrumentInput, raw),
    failed,
  );
}

function checkRunAgainstV2(
  definitionInput: unknown,
  instrumentInput: unknown,
  raw: unknown,
): ValidationResult<MeasurementRunV2> {
  const definition = validateMeasurementDefinitionV2(definitionInput);
  if (!definition.ok) {
    return {
      ok: false,
      issues: definition.issues.map((issue) => ({
        ...issue,
        path: `definition${issue.path.slice(1)}`,
      })),
    };
  }
  const instrument = validateInstrumentV2(instrumentInput);
  if (!instrument.ok) {
    return {
      ok: false,
      issues: instrument.issues.map((issue) => ({
        ...issue,
        path: `instrument${issue.path.slice(1)}`,
      })),
    };
  }
  const input = snapshot(raw);
  if (!checkRunV2(input)) {
    return { ok: false, issues: schemaIssues(checkRunV2.errors) };
  }

  const issues: ValidationIssue[] = [];
  const expectedDefinition = measurementDefinitionIdentityV2(definition.value);
  const expectedInstrument = instrumentIdentityV2(instrument.value);

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
  const llm = instrument.value.method.kind === "llm";
  if (llm && input.renderIdentity === undefined) {
    issues.push({
      path: "$.renderIdentity",
      code: "schema",
      message: "an LLM run must record the rendered messages identity",
    });
  }
  if (!llm && input.renderIdentity !== undefined) {
    issues.push({
      path: "$.renderIdentity",
      code: "schema",
      message: "a program run has no rendered prompt",
    });
  }

  issues.push(
    ...assessVerdicts(definition.value.criteria, input.verdicts, { requireAll: true }).issues,
  );

  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}

export function measurementRunIdentityV2(input: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => {
    const result = guarded<ValidationResult<MeasurementRunV2>>(() => {
      const checked = snapshot(input);
      return checkRunV2(checked)
        ? { ok: true, value: checked }
        : { ok: false, issues: schemaIssues(checkRunV2.errors) };
    }, failed);
    return identifyValidated(result);
  }, failed);
}

/** Dispatch on the schema identifier; v1 behavior stays exactly as before. */
export function validateAnyDefinition(raw: unknown): ValidationResult<AnyMeasurementDefinition> {
  return schemaOf(raw) === DEFINITION_V2
    ? validateMeasurementDefinitionV2(raw)
    : validateDefinition(raw);
}

export function validateAnyInstrument(raw: unknown): ValidationResult<AnyInstrumentProfile> {
  return schemaOf(raw) === "lorelum.judge.instrument-profile/v2"
    ? validateInstrumentV2(raw)
    : validateInstrument(raw);
}

export function anyDefinitionIdentity(input: unknown): IdentityOutcome {
  return schemaOf(input) === DEFINITION_V2
    ? measurementDefinitionIdentityV2(input)
    : definitionIdentity(input);
}

export function anyInstrumentIdentity(input: unknown): IdentityOutcome {
  return schemaOf(input) === "lorelum.judge.instrument-profile/v2"
    ? instrumentIdentityV2(input)
    : instrumentIdentity(input);
}

export function validateAnyRun(
  definitionInput: unknown,
  instrumentInput: unknown,
  raw: unknown,
): ValidationResult<MeasurementRun | MeasurementRunV2> {
  return schemaOf(definitionInput) === DEFINITION_V2
    ? validateMeasurementRunV2(definitionInput, instrumentInput, raw)
    : validateRun(definitionInput, instrumentInput, raw);
}

/**
 * True when a completed run is bound to the supplied evidence bundle. v1 runs
 * carry no evidence identity, so their existing semantics are unchanged.
 */
export function measurementRunEvidenceIdentityMatches(run: unknown, bundle: unknown): boolean {
  if (typeof run !== "object" || run === null || !("schema" in run)) return false;
  if (run.schema === "lorelum.judge.measurement-run/v1") return true;
  if (
    run.schema !== "lorelum.judge.measurement-run/v2" ||
    !("evidenceIdentity" in run) ||
    typeof run.evidenceIdentity !== "string"
  ) {
    return false;
  }
  const identity = evidenceBundleIdentity(bundle);
  return identity.ok && identity.identity === run.evidenceIdentity;
}

export type ReviewEvidenceStatus = EvidenceItem["status"];
