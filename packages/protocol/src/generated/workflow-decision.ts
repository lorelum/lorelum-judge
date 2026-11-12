// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


/**
 * A host-reported decision; the record does not authenticate its origin or grant operation permissions.
 */
export interface WorkflowDecision {
schema: "workflow-decision/v1"
planId: string
revision: number
planIdentity: string
action: ("confirm" | "revoke" | "invalidate")
/**
 * Host-controlled audit event reference; not proof of identity or authorization.
 */
hostDecisionRef: string
}
