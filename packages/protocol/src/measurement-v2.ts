import { validateCriteria, validateVerdict } from "./criterion.js";
import {
  evidenceBundleIdentity,
  validateEvidenceBundle,
  validateVerdictEvidence,
} from "./evidence.js";
import type { EvidenceItem } from "./generated/evidence-item.js";
import type { InstrumentProfile } from "./generated/instrument-profile.js";
import type { InstrumentProfileV2 } from "./generated/instrument-profile-v2.js";
import type { MeasurementDefinition } from "./generated/measurement-definition.js";
import type { MeasurementDefinitionV2 } from "./generated/measurement-definition-v2.js";
import type { MeasurementRun } from "./generated/measurement-run.js";
import type { MeasurementRunV2 } from "./generated/measurement-run-v2.js";
import type { ReviewExecution } from "./generated/review-execution.js";
import { identityOf } from "./identity.js";
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
import reviewExecutionSchema from "./schemas/review-execution.schema.json" with { type: "json" };
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
export type ReviewAttempt = ReviewExecution["attempts"][number];
export type ReviewIssue = NonNullable<ReviewAttempt["issues"]>[number];

const checkDefinitionV2 = compileSchema<MeasurementDefinitionV2>(definitionV2Schema);
const checkInstrumentV2 = compileSchema<InstrumentProfileV2>(instrumentV2Schema);
const checkRunV2 = compileSchema<MeasurementRunV2>(runV2Schema);
const checkExecution = compileSchema<ReviewExecution>(reviewExecutionSchema);

const DEFINITION_V1 = "lorelum.judge.measurement-definition/v1";
const DEFINITION_V2 = "lorelum.judge.measurement-definition/v2";
const INSTRUMENT_V1 = "lorelum.judge.instrument-profile/v1";

function schemaOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("schema" in raw)) {
    return undefined;
  }
  return raw.schema;
}

function identify<T extends { readonly schema: string }>(
  validated: ValidationResult<T>,
): IdentityOutcome {
  if (!validated.ok) {
    return validated;
  }
  const result = identityOf(validated.value.schema, validated.value);
  return result.ok
    ? result
    : {
        ok: false,
        issues: [
          {
            path: result.error.path,
            code: "schema",
            message: `identity: ${result.error.reason}`,
          },
        ],
      };
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
        code: "missing_verdict",
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
  return identify(validateMeasurementDefinitionV2(input));
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
  return identify(validateInstrumentV2(input));
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

export function measurementRunIdentityV2(input: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => {
    const result = guarded<ValidationResult<MeasurementRunV2>>(() => {
      const checked = snapshot(input);
      return checkRunV2(checked)
        ? { ok: true, value: checked }
        : { ok: false, issues: schemaIssues(checkRunV2.errors) };
    }, failed);
    return identify(result);
  }, failed);
}

function attemptIssues(
  execution: ReviewExecution,
  definition: MeasurementDefinitionV2,
  instrument: InstrumentProfileV2,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const definitionId = measurementDefinitionIdentityV2(definition);
  const instrumentId = instrumentIdentityV2(instrument);
  if (definitionId.ok && execution.definitionIdentity !== definitionId.identity) {
    issues.push({
      path: "$.definitionIdentity",
      code: "identity_mismatch",
      message: "execution was not planned for this definition",
    });
  }
  if (instrumentId.ok && execution.instrumentIdentity !== instrumentId.identity) {
    issues.push({
      path: "$.instrumentIdentity",
      code: "identity_mismatch",
      message: "execution was not planned for this instrument",
    });
  }
  if (execution.attempts.length !== execution.plannedCount) {
    issues.push({
      path: "$.attempts",
      code: "report_mismatch",
      message: "attempts must describe every planned execution, including not_started",
    });
  }
  const criteria = new Map(definition.criteria.map((criterion) => [criterion.id, criterion]));
  const attemptIds = new Set<string>();
  const llm = instrument.method.kind === "llm";

  for (const [index, attempt] of execution.attempts.entries()) {
    const path = `$.attempts[${index}]`;
    if (attempt.index !== index) {
      issues.push({
        path: `${path}.index`,
        code: "report_mismatch",
        message: `attempt index is ${attempt.index}, expected ${index}`,
      });
    }
    if (attemptIds.has(attempt.id)) {
      issues.push({
        path: `${path}.id`,
        code: "duplicate_verdict",
        message: `attempt id "${attempt.id}" is used more than once`,
      });
    }
    attemptIds.add(attempt.id);

    const hasStarted = attempt.startedAt !== undefined;
    const hasFinished = attempt.finishedAt !== undefined;
    if (attempt.status === "not_started") {
      if (
        hasStarted ||
        hasFinished ||
        attempt.verdicts !== undefined ||
        attempt.evidenceBundle !== undefined ||
        attempt.run !== undefined ||
        attempt.failure !== undefined ||
        attempt.llm !== undefined ||
        attempt.issues !== undefined
      ) {
        issues.push({
          path,
          code: "report_mismatch",
          message: "a not_started attempt carries no execution facts",
        });
      }
      continue;
    }
    if (!hasStarted || !hasFinished) {
      issues.push({
        path,
        code: "report_mismatch",
        message: `${attempt.status} attempt needs startedAt and finishedAt`,
      });
    }
    if (attempt.llm !== undefined && !llm) {
      issues.push({
        path: `${path}.llm`,
        code: "report_mismatch",
        message: "a program attempt has no model request or response",
      });
    }
    if (llm && attempt.status !== "cancelled" && attempt.llm === undefined) {
      issues.push({
        path: `${path}.llm`,
        code: "report_mismatch",
        message: "an LLM attempt records its request and response facts",
      });
    }

    if (attempt.status === "completed") {
      if (attempt.run === undefined || attempt.evidenceBundle === undefined) {
        issues.push({
          path,
          code: "report_mismatch",
          message: "a completed attempt needs a run and its evidence bundle",
        });
        continue;
      }
      if (
        attempt.verdicts !== undefined ||
        attempt.failure !== undefined ||
        attempt.issues !== undefined
      ) {
        issues.push({
          path,
          code: "report_mismatch",
          message: "a completed attempt carries its verdicts in the run and no issues",
        });
      }
      const run = validateMeasurementRunV2(definition, instrument, attempt.run);
      if (!run.ok) {
        issues.push(
          ...run.issues.map((issue) => ({ ...issue, path: `${path}.run${issue.path.slice(1)}` })),
        );
        continue;
      }
      const bundle = validateEvidenceBundle(attempt.evidenceBundle);
      if (!bundle.ok) {
        issues.push(
          ...bundle.issues.map((issue) => ({
            ...issue,
            path: `${path}.evidenceBundle${issue.path.slice(1)}`,
          })),
        );
        continue;
      }
      if (run.value.executionId !== execution.id) {
        issues.push({
          path: `${path}.run.executionId`,
          code: "identity_mismatch",
          message: "run does not belong to this execution",
        });
      }
      const evidenceId = evidenceBundleIdentity(bundle.value);
      if (evidenceId.ok && run.value.evidenceIdentity !== evidenceId.identity) {
        issues.push({
          path: `${path}.run.evidenceIdentity`,
          code: "identity_mismatch",
          message: "run does not record this evidence bundle",
        });
      }
      continue;
    }

    if (attempt.status === "partial") {
      if (
        attempt.run !== undefined ||
        attempt.failure !== undefined ||
        attempt.evidenceBundle === undefined ||
        attempt.verdicts === undefined ||
        attempt.verdicts.length === 0 ||
        attempt.issues === undefined ||
        attempt.issues.length === 0
      ) {
        issues.push({
          path,
          code: "report_mismatch",
          message: "a partial attempt has legal verdicts and issues but no complete run or failure",
        });
        continue;
      }
      const bundle = validateEvidenceBundle(attempt.evidenceBundle);
      if (!bundle.ok) {
        issues.push(
          ...bundle.issues.map((issue) => ({
            ...issue,
            path: `${path}.evidenceBundle${issue.path.slice(1)}`,
          })),
        );
        continue;
      }
      const seen = new Set<string>();
      for (const [verdictIndex, verdict] of attempt.verdicts.entries()) {
        const criterion = criteria.get(verdict.criterionId);
        if (criterion === undefined) {
          issues.push({
            path: `${path}.verdicts[${verdictIndex}].criterionId`,
            code: "unknown_criterion",
            message: `unknown criterion "${verdict.criterionId}"`,
          });
          continue;
        }
        if (seen.has(verdict.criterionId)) {
          issues.push({
            path: `${path}.verdicts[${verdictIndex}].criterionId`,
            code: "duplicate_verdict",
            message: `criterion "${verdict.criterionId}" has more than one legal verdict`,
          });
        }
        seen.add(verdict.criterionId);
        const checked = validateVerdictEvidence(criterion, verdict, bundle.value);
        if (!checked.ok) {
          issues.push(
            ...checked.issues.map((issue) => ({
              ...issue,
              path: `${path}.verdicts[${verdictIndex}]${issue.path.slice(1)}`,
            })),
          );
        }
      }
      continue;
    }

    if (attempt.status === "failed") {
      if (attempt.failure === undefined || attempt.run !== undefined) {
        issues.push({
          path,
          code: "report_mismatch",
          message: "a failed attempt has a structured failure and no run",
        });
      }
      if (attempt.verdicts !== undefined) {
        issues.push({
          path: `${path}.verdicts`,
          code: "report_mismatch",
          message: "a failed attempt has no legal verdicts",
        });
      }
      continue;
    }

    if (attempt.status === "cancelled") {
      if (
        attempt.run !== undefined ||
        attempt.verdicts !== undefined ||
        attempt.failure !== undefined
      ) {
        issues.push({
          path,
          code: "report_mismatch",
          message: "a cancelled attempt does not become a measurement",
        });
      }
    }
  }

  return issues;
}

export function validateReviewExecution(
  raw: unknown,
  definitionInput: unknown,
  instrumentInput: unknown,
): ValidationResult<ReviewExecution> {
  return guarded<ValidationResult<ReviewExecution>>(() => {
    const input = snapshot(raw);
    if (!checkExecution(input)) {
      return { ok: false, issues: schemaIssues(checkExecution.errors) };
    }
    const definition = validateMeasurementDefinitionV2(definitionInput);
    const instrument = validateInstrumentV2(instrumentInput);
    if (!definition.ok || !instrument.ok) {
      return {
        ok: false,
        issues: [
          ...(!definition.ok
            ? definition.issues.map((issue) => ({
                ...issue,
                path: `definition${issue.path.slice(1)}`,
              }))
            : []),
          ...(!instrument.ok
            ? instrument.issues.map((issue) => ({
                ...issue,
                path: `instrument${issue.path.slice(1)}`,
              }))
            : []),
        ],
      };
    }
    const issues = attemptIssues(input, definition.value, instrument.value);
    return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
  }, failed);
}

export function reviewExecutionIdentity(input: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => {
    const checked = guarded<ValidationResult<ReviewExecution>>(() => {
      const copy = snapshot(input);
      return checkExecution(copy)
        ? { ok: true, value: copy }
        : { ok: false, issues: schemaIssues(checkExecution.errors) };
    }, failed);
    return identify(checked);
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
