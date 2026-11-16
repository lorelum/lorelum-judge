// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface WorkflowSessionEvent {
schema: "workflow-session-event/v1"
sessionId: string
sequence: number
stage: ("proposed" | "authorization" | "started" | "result" | "check" | "terminal")
actionId: (string | null)
actionKind: ("read" | "write" | "command" | "model" | "check" | "review" | "unknown" | null)
status: ("proposed" | "allowed" | "denied" | "started" | "completed" | "passed" | "failed" | "cancelled" | "timed_out" | "truncated" | "unavailable" | "not_started" | "unknown")
reason: ("revoked" | "expired" | "permission_denied" | "precondition_changed" | "budget_exceeded" | "unavailable" | "error" | "unknown" | null)
}
