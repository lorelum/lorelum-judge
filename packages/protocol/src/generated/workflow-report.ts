// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Identity = string

export interface WorkflowReport {
schema: "workflow-report/v1"
executionIdentity: Identity
evidenceIdentity: Identity
planIdentity: Identity
candidateIdentity: (string | null)
reviewIdentity: (string | null)
gateIdentity: (string | null)
diff: string
quality: ("passed" | "failed" | "unknown")
checks: ("complete" | "incomplete")
enforcement: ("eligible" | "ineligible" | "unknown")
unknowns: string[]
}
