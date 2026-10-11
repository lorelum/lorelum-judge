// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface CompilationReport {
schema: "lorelum.judge.compilation-report/v1"
contractIdentity: string
covered: {
acceptanceId: string
/**
 * @minItems 1
 */
criterionIds: [string, ...(string)[]]
}[]
uncovered: Gap[]
unsupported: Gap[]
merged: {
criterionId: string
/**
 * @minItems 1
 */
mergedFrom: [string, ...(string)[]]
}[]
excluded: {
criterionId: string
code: ("not_applicable" | "conflict")
reason: string
}[]
}
export interface Gap {
acceptanceId: string
reason: string
}
