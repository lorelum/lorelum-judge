import { assessVerdicts } from "./assessment.js";
import { evidenceBundleIdentity } from "./evidence.js";
import type { EvidenceItem } from "./generated/evidence-item.js";
import type { MeasurementRunV2 } from "./generated/measurement-run-v2.js";
import { identifyValidated } from "./identity.js";
import type { IdentityOutcome } from "./measurement.js";
import {
  measurementDefinitionIdentityV2,
  validateMeasurementDefinitionV2,
} from "./measurement-v2-definition.js";
import { instrumentIdentityV2, validateInstrumentV2 } from "./measurement-v2-instrument.js";
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

const checkRunV2 = compileSchema<MeasurementRunV2>(runV2Schema);

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
