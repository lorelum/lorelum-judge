// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface InstrumentProfile {
schema: "lorelum.judge.instrument-profile/v1"
model: {
provider: string
name: string
version?: string
}
decoding: {
temperature?: number
topP?: number
maxTokens?: number
seed?: number
}
promptIdentity: string
runtime: {
name: string
version: string
}
repetitions: number
}
