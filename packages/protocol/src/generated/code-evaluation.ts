// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type CodeEvaluationRecord = (Source | Plan | Result | Report)
export type Id = string
export type Text = string
export type Identity = string
export type Strings = string[]
export type Ids = Id[]
export type Verdicts = Verdict[]
export type Issues = Issue1[]
export type Ids1 = string[]

export interface Source {
schema: "lorelum.judge.source-snapshot/v1"
items: Item[]
issues: Issue[]
discovered: Strings
omitted: Strings
comparisons: {
source: Text
kind: Text
base: Text
head: Text
mergeBase?: Text
addedPaths?: Strings
deletedPaths?: Strings
}[]
consistent: boolean
}
export interface Item {
id: Id
role: ("target" | "context" | "requirement" | "opinion")
path: Text
side: ("current" | "old" | "new")
version: Text
contentIdentity: Identity
text: string
startLine: number
endLine: number
complete: boolean
provenance: ("provided" | "local" | "git" | "github" | "patch")
}
export interface Issue {
code: Text
message: Text
source?: string
fatal?: boolean
}
export interface Plan {
schema: "lorelum.judge.review-plan/v1"
request: Text
task: ("inspect" | "overview" | "change" | "requirements" | "verify" | "recheck")
standardsVersion: Text
definition: MeasurementDefinitionV2
sourceIdentity: Identity
evidenceBudget?: number
requirements: {
id: Id
text: Text
source: Text
}[]
excluded: {
id: Id
reason: Text
}[]
focus: Strings
}
export interface MeasurementDefinitionV2 {
schema: "lorelum.judge.measurement-definition/v2"
id: string
/**
 * @minItems 1
 */
criteria: [Criterion, ...(Criterion)[]]
/**
 * @minItems 1
 */
metadata: [{
criterionId: string
role: ("decisive" | "advisory")
covers?: string[]
appliesTo?: string[]
}, ...({
criterionId: string
role: ("decisive" | "advisory")
covers?: string[]
appliesTo?: string[]
})[]]
provenance?: {
rubricId?: string
rubricIdentity?: string
contractIdentity?: string
migratedFrom?: "lorelum.judge.measurement-definition/v1"
sourceIdentity?: string
}
}
export interface Criterion {
schema: "lorelum.judge.criterion/v1"
id: string
kind: ("contract" | "quality" | "comparison")
description: string
mandatory: boolean
source?: Source1
anchors: Anchor[]
evidence: EvidenceSelector[]
}
export interface Source1 {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
export interface Anchor {
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse")
description: string
}
export interface EvidenceSelector {
evidenceId: string
role: ("primary" | "reference")
}
export interface Result {
schema: "lorelum.judge.review-result/v2"
verdicts: Verdict[]
summary: {
text: Text
criterionIds: Ids
problemIds: Ids
evidenceIds: Ids
}[]
problems: Problem[]
pending: Pending[]
followUps: FollowUp[]
}
export interface Verdict {
schema: "lorelum.judge.verdict/v1"
criterionId: string
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse" | "unknown" | "insufficient")
evidenceIds: string[]
rationale?: string
}
export interface Problem {
id: Id
criterionId: Id
title: Text
severity: ("high" | "medium" | "low")
condition: Text
impact: Text
rationale: Text
/**
 * @minItems 1
 */
evidenceIds: [Id, ...(Id)[]]
/**
 * @minItems 1
 */
locations: [Location, ...(Location)[]]
attribution: ("introduced" | "amplified" | "pre_existing" | "undetermined" | "not_applicable")
}
export interface Location {
itemId: Id
startLine: number
endLine: number
}
export interface Pending {
id: Id
criterionId: Id
question: Text
reason: Text
evidenceIds: Ids
}
export interface FollowUp {
id: Id
reference: Text
outcome: ("supported" | "conditional" | "unsupported" | "unresolved" | "resolved" | "persists")
rationale: Text
evidenceIds: Ids
}
export interface Report {
schema: "lorelum.judge.code-evaluation-report/v1"
id: Id
status: ("completed" | "partial" | "failed" | "cancelled")
request: Text
source: Source
sourceIdentity: Identity
plan?: Plan
planIdentity?: Identity
execution?: ReviewExecutionV2
preparation: Preparation[]
result?: Result
issues: Issue[]
limitations: Strings
previousReportIdentity?: Identity
rendererVersion: Text
}
export interface ReviewExecutionV2 {
schema: "lorelum.judge.review-execution/v2"
id: string
inputIdentity: string
definitionIdentity: string
instrumentIdentity: string
sourceIdentity: string
planIdentity: string
instrument: InstrumentProfileV2
plannedCount: number
shownLines?: {
[k: string]: number[]
}
followUpReferences?: string[]
/**
 * @minItems 1
 */
attempts: [{
id: string
index: number
status: ("completed" | "partial" | "failed" | "cancelled" | "not_started")
startedAt?: string
finishedAt?: string
verdicts?: Verdicts
issues?: Issues
evidenceBundle?: EvidenceBundle
run?: MeasurementRunV2
failure?: Failure
llm?: Llm
result?: Result1
rawResult?: unknown
}, ...({
id: string
index: number
status: ("completed" | "partial" | "failed" | "cancelled" | "not_started")
startedAt?: string
finishedAt?: string
verdicts?: Verdicts
issues?: Issues
evidenceBundle?: EvidenceBundle
run?: MeasurementRunV2
failure?: Failure
llm?: Llm
result?: Result1
rawResult?: unknown
})[]]
}
export interface InstrumentProfileV2 {
schema: "lorelum.judge.instrument-profile/v2"
method: (ProgramMethod | LlmMethod)
}
export interface ProgramMethod {
kind: "program"
checker: {
id: string
version?: string
contentIdentity?: string
}
implementationVersion: string
resultProtocolVersion: string
parserVersion: string
runtime: Runtime
repetitions: number
}
export interface Runtime {
name: string
version: string
}
export interface LlmMethod {
kind: "llm"
provider: {
protocol: string
adapterVersion: string
}
endpointIdentity: string
model: {
provider: string
name: string
version?: string
}
decoding: Decoding
promptIdentity: string
compilerVersion: string
renderVersion: string
parserVersion: string
runtime: Runtime
repetitions: number
}
export interface Decoding {
temperature?: number
topP?: number
maxTokens?: number
seed?: number
}
export interface Issue1 {
criterionId?: string
path: string
code: string
message: string
}
export interface EvidenceBundle {
schema: "lorelum.judge.evidence-bundle/v1"
items: EvidenceItem[]
}
export interface EvidenceItem {
schema: "lorelum.judge.evidence-item/v1"
id: string
status: ("present" | "no_evidence" | "unavailable" | "contradiction")
contentIdentity?: string
render?: {
state: ("rendered" | "withheld" | "truncated")
originalLength: number
renderedLength: number
}
conflictsWith?: string[]
}
export interface MeasurementRunV2 {
schema: "lorelum.judge.measurement-run/v2"
id: string
definitionIdentity: string
instrumentIdentity: string
instrumentSource: "declared"
executionId: string
evidenceIdentity: string
renderIdentity?: string
verdicts: Verdict[]
}
export interface Failure {
category: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
code: string
message: string
httpStatus?: number
}
export interface Llm {
request: {
model: string
modelProvider: string
endpointIdentity: string
parameters: {
temperature?: number
topP?: number
maxTokens?: number
seed?: number
}
messagesIdentity?: string
promptIdentity?: string
renderIdentity?: string
timeoutMs?: number
}
response?: {
provider?: string
model?: string
responseId?: string
finishReason?: string
status?: string
usage?: Usage
}
unknowns: string[]
rawResponse?: string
}
export interface Usage {
promptTokens?: number
completionTokens?: number
totalTokens?: number
}
export interface Result1 {
schema: "lorelum.judge.review-result/v2"
verdicts: Verdict[]
summary: {
text: string
criterionIds: Ids1
problemIds: Ids1
evidenceIds: Ids1
}[]
problems: Problem1[]
pending: Pending1[]
followUps: FollowUp1[]
}
export interface Problem1 {
id: string
criterionId: string
title: string
severity: ("high" | "medium" | "low")
condition: string
impact: string
rationale: string
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
/**
 * @minItems 1
 */
locations: [Location1, ...(Location1)[]]
attribution: ("introduced" | "amplified" | "pre_existing" | "undetermined" | "not_applicable")
}
export interface Location1 {
itemId: string
startLine: number
endLine: number
}
export interface Pending1 {
id: string
criterionId: string
question: string
reason: string
evidenceIds: Ids1
}
export interface FollowUp1 {
id: string
reference: string
outcome: ("supported" | "conditional" | "unsupported" | "unresolved" | "resolved" | "persists")
rationale: string
evidenceIds: Ids1
}
export interface Preparation {
stage: Text
status: ("completed" | "failed" | "cancelled")
requestIdentity?: Identity
responseIdentity?: Identity
model?: Text
error?: Text
}
