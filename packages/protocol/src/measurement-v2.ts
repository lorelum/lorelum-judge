export * from "./measurement-v2-definition.js";
export * from "./measurement-v2-instrument.js";
export * from "./measurement-v2-run.js";

import type { MeasurementRun } from "./generated/measurement-run.js";
import type { MeasurementRunV2 } from "./generated/measurement-run-v2.js";
import {
  definitionIdentity,
  type IdentityOutcome,
  instrumentIdentity,
  validateDefinition,
  validateInstrument,
  validateRun,
} from "./measurement.js";
import {
  type AnyMeasurementDefinition,
  measurementDefinitionIdentityV2,
  validateMeasurementDefinitionV2,
} from "./measurement-v2-definition.js";
import {
  type AnyInstrumentProfile,
  instrumentIdentityV2,
  validateInstrumentV2,
} from "./measurement-v2-instrument.js";
import { validateMeasurementRunV2 } from "./measurement-v2-run.js";
import { DEFINITION_V2, schemaOf } from "./measurement-v2-shared.js";
import type { ValidationResult } from "./validation.js";

export type { InstrumentProfileV2 } from "./generated/instrument-profile-v2.js";
export type { MeasurementDefinitionV2 } from "./generated/measurement-definition-v2.js";
export type { MeasurementRunV2 } from "./generated/measurement-run-v2.js";
export type { ReviewExecution } from "./generated/review-execution.js";
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
