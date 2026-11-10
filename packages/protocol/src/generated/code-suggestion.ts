// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type CodeSuggestionRecord = (Result | Report)
export type Id = string
export type Text = string
export type Texts = Text[]
export type Identity = string
export type Ids = Id[]

export interface Result {
schema: "lorelum.judge.code-suggestion-result/v1"
suggestions: Suggestion[]
omissions: Omission[]
}
export interface Suggestion {
id: Id
problemId: Id
/**
 * @minItems 1
 */
evidenceIds: [Id, ...(Id)[]]
location: Location
category: ("required" | "optional" | "preference")
problem: Text
priorityRationale: Text
direction: Text
impact: Text
/**
 * @minItems 1
 */
checks: [Text, ...(Text)[]]
uncertainPremises: Texts
alternatives: {
direction: Text
applicability: Text
tradeoffs: Text
}[]
example?: Text
}
export interface Location {
itemId: Id
startLine: number
endLine: number
}
export interface Omission {
id: Id
description: Text
/**
 * @minItems 1
 */
evidenceIds: [Id, ...(Id)[]]
location: Location
}
export interface Report {
schema: "lorelum.judge.code-suggestion-report/v1"
status: ("completed" | "partial" | "failed" | "cancelled")
evaluationIdentity: Identity
sourceIdentity: Identity
codeIdentity: Identity
selectedProblemIds: Ids
result?: Result
gaps: {
problemId?: Id
code: Text
message: Text
}[]
limitations: Texts
method?: {
kind: "llm"
provider: {
protocol: Text
adapterVersion: Text
}
endpointIdentity: Identity
model: {
provider: Text
name: Text
version?: Text
}
decoding?: {
temperature?: number
topP?: number
maxTokens?: number
seed?: number
}
}
responseMetadata?: {
provider?: Text
model?: Text
responseId?: Text
finishReason?: Text
status?: Text
usage?: {
promptTokens?: number
completionTokens?: number
totalTokens?: number
}
}
requestIdentity?: Identity
responseIdentity?: Identity
error?: Text
}
