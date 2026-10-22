// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Ids = string[]

export interface ReviewResultV2 {
schema: "lorelum.judge.review-result/v2"
verdicts: Verdict[]
summary: {
text: string
criterionIds: Ids
problemIds: Ids
evidenceIds: Ids
}[]
problems: Problem[]
pending: Pending[]
followUps: FollowUp[]
}
export interface Verdict {
schema: "lorelum.judge.verdict/v1"
criterionId: string
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse" | "unknown" | "insufficient")
evidenceIds: string[]
rationale?: string
}
export interface Problem {
id: string
criterionId: string
title: string
severity: ("high" | "medium" | "low")
condition: string
impact: string
rationale: string
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
/**
 * @minItems 1
 */
locations: [Location, ...(Location)[]]
attribution: ("introduced" | "amplified" | "pre_existing" | "undetermined" | "not_applicable")
}
export interface Location {
itemId: string
startLine: number
endLine: number
}
export interface Pending {
id: string
criterionId: string
question: string
reason: string
evidenceIds: Ids
}
export interface FollowUp {
id: string
reference: string
outcome: ("supported" | "conditional" | "unsupported" | "unresolved" | "resolved" | "persists")
rationale: string
evidenceIds: Ids
}
