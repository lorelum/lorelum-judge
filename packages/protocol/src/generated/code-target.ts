// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type CodeTarget = ({
kind: "snippet"
text: string
name?: string
language?: string
} | {
kind: "files"
files: {
path: string
text: string
role?: ("target" | "context" | "requirement" | "opinion")
}[]
} | {
kind: "diff"
text: string
name?: string
} | {
kind: "comparison"
old: Files
new: Files
} | {
kind: "local"
path: string
ref?: string
} | {
kind: "git"
path: string
selection: ("staged" | "unstaged" | "untracked" | "commit" | "compare" | "branch" | "working")
base?: string
head?: string
paths?: string[]
parent?: number
} | {
kind: "github"
url: string
})
export type Files = File[]

export interface File {
path: string
text: string
}
