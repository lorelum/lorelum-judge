// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Identity = string

export interface WorkflowEvidence {
schema: "workflow-evidence/v1"
executionIdentity: Identity
candidateIdentity: (string | null)
checks: {
id: string
executable: string
args: string[]
cwd: string
version: (string | null)
environmentIdentity: (string | null)
timeoutMs: number
maxOutputBytes: number
readPaths: string[]
status: ("passed" | "failed" | "cancelled" | "timed_out" | "truncated" | "unavailable" | "not_started")
exitCode: (number | null)
stdout: string
stderr: string
}[]
}
