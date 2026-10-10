// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface MeasurementRun {
schema: "lorelum.judge.measurement-run/v1"
id: string
definitionIdentity: string
instrumentIdentity: string
instrumentSource: "declared"
verdicts: Verdict[]
}
export interface Verdict {
schema: "lorelum.judge.verdict/v1"
criterionId: string
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse" | "unknown" | "insufficient")
evidenceIds: string[]
rationale?: string
}
