// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface EvidenceBundle {
schema: "lorelum.judge.evidence-bundle/v1"
items: EvidenceItem[]
}
export interface EvidenceItem {
schema: "lorelum.judge.evidence-item/v1"
id: string
status: ("present" | "no_evidence" | "unavailable" | "contradiction")
contentIdentity?: string
render?: {
state: ("rendered" | "withheld" | "truncated")
originalLength: number
renderedLength: number
}
conflictsWith?: string[]
}
