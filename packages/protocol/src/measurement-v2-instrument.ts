import type { InstrumentProfile } from "./generated/instrument-profile.js";
import type { InstrumentProfileV2 } from "./generated/instrument-profile-v2.js";
import { identifyValidated } from "./identity.js";
import type { IdentityOutcome } from "./measurement.js";
import { INSTRUMENT_V1 } from "./measurement-v2-shared.js";
import instrumentV2Schema from "./schemas/instrument-profile-v2.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  snapshot,
  type ValidationResult,
} from "./validation.js";

export type AnyInstrumentProfile = InstrumentProfile | InstrumentProfileV2;

const checkInstrumentV2 = compileSchema<InstrumentProfileV2>(instrumentV2Schema);

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
export function instrumentRepetitions(instrument: AnyInstrumentProfile): number {
  return instrument.schema === INSTRUMENT_V1
    ? instrument.repetitions
    : instrument.method.repetitions;
}
