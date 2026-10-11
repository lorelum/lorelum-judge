// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface RubricSet {
schema: "lorelum.judge.rubric-set/v1"
id: string
status: ("proposal" | "frozen")
contractIdentity: string
/**
 * @minItems 1
 */
entries: [{
criterion: Criterion
/**
 * @minItems 1
 */
covers: [string, ...(string)[]]
/**
 * @minItems 1
 */
appliesTo: [string, ...(string)[]]
role: ("decisive" | "advisory")
}, ...({
criterion: Criterion
/**
 * @minItems 1
 */
covers: [string, ...(string)[]]
/**
 * @minItems 1
 */
appliesTo: [string, ...(string)[]]
role: ("decisive" | "advisory")
})[]]
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
