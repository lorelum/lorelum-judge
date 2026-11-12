// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface WorkflowWorkspace {
schema: "workflow-workspace/v1"
sourceIdentity: string
gitIdentity: string
rootIdentity: {
dev: string
ino: string
}
files: {
path: string
source: ("committed" | "modified" | "untracked" | "unknown")
excluded: boolean
exclusionReason: (string | null)
status: ("present" | "deleted" | "unknown")
contentIdentity: (string | null)
mode: (number | null)
}[]
}
