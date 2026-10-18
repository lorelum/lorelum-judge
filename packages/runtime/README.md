# @lorelum/judge-runtime

Owns the framework-neutral agent runtime, runtime ports, step/event/state
contracts, cancellation, and tool dispatch boundaries.

It depends on `@lorelum/judge-protocol` and must not import an Agent framework,
provider SDK, rubric, verdict, calibration, or gate implementation. Its first
runtime contract is defined by #4.

## Model configuration and metadata

`ModelRequest` may carry a provider-neutral `config` (`model`, `temperature`,
`topP`, `maxTokens`, `seed`). `RuntimeRequest.modelConfig` is forwarded by the
reference loop. Only fields the caller set are present; the provider must send
exactly those and must not invent defaults. `ModelResponse` message results may
carry whitelisted `metadata` (`provider`, `model`, `responseId`, `finishReason`,
`status`, `usage`). The response model is a declaration, not proof of remote
weights or decoding. Provider SDK types do not enter these ports.
