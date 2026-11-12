# @lorelum/judge-runtime

Owns the framework-neutral agent runtime, runtime ports, step/event/state
contracts, cancellation, and tool dispatch boundaries.

It depends on `@lorelum/judge-protocol` and must not import an Agent framework,
provider SDK, rubric, verdict, calibration, or gate implementation. Its first
runtime contract is defined by #4.

`SandboxPort` is the execution boundary for an injected sandbox adapter. Its
request names a private host copy, explicitly authorized command-readable paths
and writable relative directories, argv, working directory, output and time
limits, and an abort signal. An adapter must reject read scopes it cannot enforce.
Runtime itself does not provide isolation or authorize execution.

## Model configuration and metadata

`ModelRequest` may carry a provider-neutral `config` (`model`, `temperature`,
`topP`, `maxTokens`, `seed`). `RuntimeRequest.modelConfig` is forwarded by the
reference loop. Only fields the caller set are present; the provider must send
exactly those and must not invent defaults. `validateGenerationConfig` is the
canonical bounds check shared with providers. Providers should throw
`ModelPortError` (or a subclass) for transport failures; callers use
`isModelPortError` instead of guessing from arbitrary `code` properties.
`ModelResponse` message results may
carry whitelisted `metadata` (`provider`, `model`, `responseId`, `finishReason`,
`status`, `usage`). The response model is a declaration, not proof of remote
weights or decoding. Provider SDK types do not enter these ports.
