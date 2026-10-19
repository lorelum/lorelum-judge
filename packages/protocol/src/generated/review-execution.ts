// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export type Timestamp = string

export interface ReviewExecution {
schema: "lorelum.judge.review-execution/v1"
id: string
inputIdentity: string
definitionIdentity: string
instrumentIdentity: string
plannedCount: number
/**
 * @minItems 1
 */
attempts: [Attempt, ...(Attempt)[]]
}
export interface Attempt {
id: string
index: number
status: ("completed" | "partial" | "failed" | "cancelled" | "not_started")
startedAt?: Timestamp
finishedAt?: Timestamp
verdicts?: Verdict[]
issues?: Issue[]
evidenceBundle?: EvidenceBundle
run?: MeasurementRunV2
failure?: Failure
llm?: Llm
}
export interface Verdict {
schema: "lorelum.judge.verdict/v1"
criterionId: string
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse" | "unknown" | "insufficient")
evidenceIds: string[]
rationale?: string
}
export interface Issue {
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
