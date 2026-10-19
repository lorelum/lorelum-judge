import { assessVerdicts } from "./assessment.js";
import { evidenceBundleIdentity, validateEvidenceBundle } from "./evidence.js";
import type { InstrumentProfileV2 } from "./generated/instrument-profile-v2.js";
import type { MeasurementDefinitionV2 } from "./generated/measurement-definition-v2.js";
import type { ReviewExecution } from "./generated/review-execution.js";
import { identifyValidated } from "./identity.js";
import type { IdentityOutcome } from "./measurement.js";
import {
  instrumentIdentityV2,
  measurementDefinitionIdentityV2,
  validateInstrumentV2,
  validateMeasurementDefinitionV2,
  validateMeasurementRunV2,
} from "./measurement-v2.js";
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

export type ReviewAttempt = ReviewExecution["attempts"][number];
export type ReviewIssue = NonNullable<ReviewAttempt["issues"]>[number];

const checkExecution = compileSchema<ReviewExecution>(reviewExecutionSchema);

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
      issues.push(
        ...assessVerdicts(definition.criteria, attempt.verdicts, {
          bundle: bundle.value,
          path: `${path}.verdicts`,
        }).issues,
      );
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
    return identifyValidated(checked);
  }, failed);
}
