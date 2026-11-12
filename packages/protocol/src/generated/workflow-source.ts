// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type WorkflowSource = {
id: string
kind: ("user" | "authority" | "reference")
locator: string
version: string
content: string
status: ("available" | "unavailable" | "truncated")
}
