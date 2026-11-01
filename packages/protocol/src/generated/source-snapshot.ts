// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Strings = string[]

export interface SourceSnapshot {
schema: "lorelum.judge.source-snapshot/v1"
items: Item[]
issues: Issue[]
discovered: Strings
omitted: Strings
comparisons: {
source: string
kind: string
base: string
head: string
mergeBase?: string
addedPaths?: Strings
deletedPaths?: Strings
}[]
consistent: boolean
}
export interface Item {
id: string
role: ("target" | "context" | "requirement" | "opinion")
path: string
side: ("current" | "old" | "new")
version: string
contentIdentity: string
text: string
startLine: number
endLine: number
complete: boolean
provenance: ("provided" | "local" | "git" | "github" | "patch")
}
export interface Issue {
code: string
message: string
source?: string
fatal?: boolean
}
