import { validateCriteria } from "./criterion.js";
import type { MeasurementDefinition } from "./generated/measurement-definition.js";
import type { MeasurementDefinitionV2 } from "./generated/measurement-definition-v2.js";
import { identifyValidated, identityOf } from "./identity.js";
import { type IdentityOutcome, validateDefinition } from "./measurement.js";
import { DEFINITION_V1, DEFINITION_V2 } from "./measurement-v2-shared.js";
import { validateRubricSet } from "./rubric.js";
import definitionV2Schema from "./schemas/measurement-definition-v2.schema.json" with {
  type: "json",
};
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type AnyMeasurementDefinition = MeasurementDefinition | MeasurementDefinitionV2;

const checkDefinitionV2 = compileSchema<MeasurementDefinitionV2>(definitionV2Schema);

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
