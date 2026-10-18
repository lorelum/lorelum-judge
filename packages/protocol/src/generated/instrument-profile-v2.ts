// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


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
