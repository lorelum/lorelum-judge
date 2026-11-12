// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Identity = string
export type Count = number

export interface WorkflowExecution {
schema: "workflow-execution/v1"
planIdentity: Identity
planRevision: number
workspaceIdentity: Identity
authorizationIdentity: Identity
status: ("completed" | "failed" | "cancelled" | "timed_out" | "unknown")
stopReason: string
usage: {
totalTimeMs: Count
commandTimeMs: Count
modelCalls: Count
actions: Count
commands: Count
outputBytes: Count
}
}
