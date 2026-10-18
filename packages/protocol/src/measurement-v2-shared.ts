export const DEFINITION_V1 = "lorelum.judge.measurement-definition/v1";
export const DEFINITION_V2 = "lorelum.judge.measurement-definition/v2";
export const INSTRUMENT_V1 = "lorelum.judge.instrument-profile/v1";

export function schemaOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("schema" in raw)) {
    return undefined;
  }
  return raw.schema;
}
