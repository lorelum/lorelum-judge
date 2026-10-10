// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


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
