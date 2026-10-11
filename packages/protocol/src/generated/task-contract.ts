// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


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
