# Runtime Port Rationale

## Position

The runtime is a replaceable execution layer, not the owner of measurement
contracts. It defines the smallest loop needed to produce persisted, resumable
agent runs without importing an Agent framework or provider SDK.

The package direction remains:

```text
protocol <- runtime <- judge <- workflow
```

Framework implementations belong in future `runtime-*` packages and provider
SDKs belong in `provider-*`. Both must implement the same public runtime ports.

## Framework Alignment

The design intentionally borrows the strongest, tested ideas from the reviewed
frameworks without copying their runtime-owned schemas:

| Reference | Adopted design | Intentional boundary |
| --- | --- | --- |
| OpenAI Agents SDK JS | Agent/run loop, tool dispatch, tracing, scripted-model test shape | Framework run state is not a persisted judge identity |
| LangGraph | Resumable state, checkpoints, explicit pause and resume | No graph node or channel types enter protocol or judge |
| Pydantic AI | Typed ports, structured output, capability-extensible agent design | Python runtime and framework object model are not adopted |
| Vercel AI SDK | Provider-neutral model and tool adapter shape | Provider streaming and SDK types stay in adapters |
| Vercel Eve / Stirrup | Coding-agent tool and execution boundaries | Sandbox and coding capabilities are separate packages |
| Pydantic Evals / DeepEval / Braintrust | Test doubles, reports, and regression-oriented evaluation | Metric or benchmark objects do not become measurement contracts |

## Deliberate Improvements

- The runtime has no dependency on any Agent framework.
- `RuntimeRun` is JSON-compatible and persisted independently from framework
  session state.
- A step-budget pause is distinguishable from completion, failure, and
  cancellation.
- Model, tool, and environment failures have different structured categories.
- Storage, clock, telemetry, model, tool, and execution port exceptions become
  structured failures instead of rejecting the run.
- `step_completed` uses the index of the step that completed; only the next
  `model_requested` event advances to the next step index.
- `resume()` returns a structured error when the current step budget cannot
  make progress, instead of returning a paused run as a successful resume.
- Conformance is a reusable suite over the public `AgentRuntime` interface, so
  a future framework adapter cannot claim compatibility from its own tests.

## Deferred Work

Framework selection and the first real `runtime-*` adapter remain separate work.
The conformance suite is the prerequisite for that comparison; it is not a
proxy for selecting a framework.
