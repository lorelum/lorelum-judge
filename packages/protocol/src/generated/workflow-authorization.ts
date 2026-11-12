// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Identity = string
export type Strings = string[]
export type Count = number

export interface WorkflowAuthorization {
schema: "workflow-authorization/v1"
planIdentity: Identity
planRevision: number
workspaceIdentity: Identity
readPaths: Strings
writePaths: Strings
writablePaths: Strings
commandReadPaths: Strings
commands: {
executable: string
args: string[]
cwd: string
}[]
disclosures: Strings
modelRecipient: (string | null)
expiresAt: (string | null)
verificationIdentity: (string | null)
verification: (null | Verification)
isolation: string
limits: Limits
decision: ("approved" | "denied")
decisionRef: string
}
export interface Verification {
schema: "workflow-verification/v1"
reviewConfigurationIdentity: (string | null)
checks: {
id: string
executable: string
args: string[]
cwd: string
version: (string | null)
environmentIdentity: (string | null)
timeoutMs: Count
maxOutputBytes: Count
readPaths: Strings
}[]
}
export interface Limits {
totalTimeMs: Count
commandTimeMs: Count
modelCalls: Count
actions: Count
commands: Count
outputBytes: Count
}
