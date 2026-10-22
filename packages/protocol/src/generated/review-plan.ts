// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Strings = string[]

export interface ReviewPlan {
schema: "lorelum.judge.review-plan/v1"
request: string
task: ("inspect" | "overview" | "change" | "requirements" | "verify" | "recheck")
standardsVersion: string
definition: MeasurementDefinitionV2
sourceIdentity: string
evidenceBudget?: number
requirements: {
id: string
text: string
source: string
}[]
excluded: {
id: string
reason: string
}[]
focus: Strings
}
export interface MeasurementDefinitionV2 {
schema: "lorelum.judge.measurement-definition/v2"
id: string
/**
 * @minItems 1
 */
criteria: [Criterion, ...(Criterion)[]]
/**
 * @minItems 1
 */
metadata: [{
criterionId: string
role: ("decisive" | "advisory")
covers?: string[]
appliesTo?: string[]
}, ...({
criterionId: string
role: ("decisive" | "advisory")
covers?: string[]
appliesTo?: string[]
})[]]
provenance?: {
rubricId?: string
rubricIdentity?: string
contractIdentity?: string
migratedFrom?: "lorelum.judge.measurement-definition/v1"
sourceIdentity?: string
}
}
export interface Criterion {
schema: "lorelum.judge.criterion/v1"
id: string
kind: ("contract" | "quality" | "comparison")
description: string
mandatory: boolean
source?: Source
anchors: Anchor[]
evidence: EvidenceSelector[]
}
export interface Source {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
export interface Anchor {
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse")
description: string
}
export interface EvidenceSelector {
evidenceId: string
role: ("primary" | "reference")
}
