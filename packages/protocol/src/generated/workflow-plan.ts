// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type WorkflowSource = {
id: string
kind: ("user" | "authority" | "reference")
locator: string
version: string
content: string
status: ("available" | "unavailable" | "truncated")
}
export type Strings = string[]

export interface WorkflowPlan {
schema: "workflow-plan/v1"
id: string
revision: number
sources: WorkflowSource[]
task: TaskContract
goal: string
scope: Strings
steps: WorkItem[]
checks: WorkItem[]
nonGoals: Strings
missing: Strings
conflicts: {
description: string
sourceIds: Strings
}[]
}
export interface TaskContract {
schema: "lorelum.judge.task-contract/v1"
id: string
taskClass: string
text: string
/**
 * @minItems 1
 */
acceptance: [{
id: string
text: string
source: Source
}, ...({
id: string
text: string
source: Source
})[]]
}
export interface Source {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
export interface WorkItem {
id: string
description: string
acceptanceIds: Strings
}
