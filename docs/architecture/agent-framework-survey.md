# Agent Framework Survey

Status: architecture survey for the foundation. It is not a framework selection.

Reviewed: 2026-09-29.

## Evaluation Criteria

The repository has three distinct technical layers:

1. **Measurement protocol**: task contracts, rubric, evidence, verdict,
   calibration, identity, and gate records.
2. **Agent runtime**: execution loop, state, tools, events, cancellation,
   persistence, recovery, and model access.
3. **Evaluation platform**: datasets, labels, reports, statistics, regression
   tracking, and long-running workflow.

No reviewed framework owns all three layers cleanly. The key question is not
"which framework is best", but which layer a framework may implement without
owning the repository's measurement identity.

The comparison uses these criteria:

- runtime abstractions: loop, tools, handoffs, state, recovery;
- durability: checkpoints, resume, retries, replay, human approval;
- provider neutrality: whether provider SDK types leak into core code;
- schema ownership: whether the framework can consume external versioned
  contracts;
- testability: scripted models, deterministic execution, fixtures, snapshots;
- TypeScript and Bun fit;
- coupling risk: whether framework types would become persisted artifacts;
- fit for judge, planner, implementer, revision, and delivery workflows.

## Executive Result

The package direction remains:

```text
protocol <- runtime <- judge <- workflow
```

Framework candidates are implementations behind `runtime` or `adapters`, never
the owner of `protocol` or `judge` domain semantics.

| Framework or SDK | Useful design reference | Must not own |
| --- | --- | --- |
| OpenAI Agents SDK JS | Lightweight run loop, tools, handoffs, tracing, scripted-model tests | Measurement contract or rubric |
| LangGraph | Durable graph state, checkpoints, resume, revision loops | Judge domain or measurement identity |
| Pydantic AI | Typed agents, capabilities, structured output, durable execution | TypeScript core dependency or persisted contracts |
| Vercel AI SDK | Model/provider/tool/streaming adapters | Judge or measurement semantics |
| Vercel Eve | Sandbox, computer use, self-modification capability boundaries | Measurement protocol |
| Stirrup | Coding-agent workflow and tool organization | Calibration or measurement |
| Mastra | TypeScript package taxonomy and provider separation | A minimal initial core |
| Google ADK JS | Core / integrations / samples repository split | Independently versioned judge contracts |
| smolagents | Minimal agent loop and code-agent reference | Production TypeScript runtime |
| Atomic Agents | Small typed composition units | Full orchestration platform |
| MCP Agent | Executor, tracing, approval, and workflow boundaries | General non-MCP runtime dependency |
| Pydantic Evals / DeepEval / Braintrust | Dataset, evaluator, report, and regression references | Persisted judge identity and gate semantics |

## Runtime References

### OpenAI Agents SDK JS

Observed strengths:

- recognizable primitives: agent, runner, tool, handoff, guardrail, session,
  run state, tracing;
- clear separation between framework core and provider/realtime packages;
- first-class scripted-model testing and run-state compatibility work;
- handoffs and guardrails are relevant to an orchestrator plus reviewer roles.

Risks:

- its agent and run types are runtime objects, not measurement contracts;
- sessions and framework run identities must not become rubric or calibration
  identities;
- importing SDK types into protocol would make runtime replacement expensive.

Fit:

- first TypeScript runtime spike candidate behind the `AgentRuntime` ports;
- not a dependency of `@lorelum/judge-protocol` or judge domain rules.

### LangGraph

Observed strengths:

- graph channels, checkpoints, streaming, and resumable execution;
- strong reference for durable state and revision loops;
- clear separation between core graph behavior and checkpoint/SDK packages.

Risks:

- graph concepts are heavier than a single judge run;
- routing can replace a stable measurement contract if adopted too early;
- graph state still does not define rubric, evidence, instrument, or calibration
  identity.

Fit:

- design reference for a future durable workflow or runtime adapter;
- not a measurement-contract layer.

### Pydantic AI

Observed strengths:

- typed input/output and structured outputs;
- explicit capabilities and deferred tools;
- durable execution separated from the base agent;
- graph and evaluation concerns are separate packages.

Risks:

- Python-first; adopting it directly would add a language or service boundary;
- its runtime objects must not become persisted measurement schemas;
- larger than the first runtime required here.

Fit:

- reference for typed ports, capabilities, structured output, durable
  execution, and evaluation packaging;
- candidate only if the runtime deliberately moves to a Python service.

### Vercel AI SDK

Observed strengths:

- strong TypeScript provider abstraction;
- streaming, tool-call, schema, and UI integration boundaries;
- provider packages can evolve separately from the core.

Risks:

- not a complete durable agent runtime;
- provider and UI concepts must not define measurement records.

Fit:

- candidate dependency for model and tool adapters;
- not a candidate for protocol or judge domain rules.

### Vercel Eve and Stirrup

Vercel Eve demonstrates separate core, code execution, computer use, and
self-modification capabilities. Stirrup demonstrates a focused coding-agent
split between clients, core, prompts, skills, and tools.

Adopted:

- sandbox and code execution are separate capabilities;
- coding tools should be inspectable and independently replaceable.

Rejected:

- copying product-specific capability packages before those capabilities exist;
- treating a coding-agent tool registry as the measurement layer.

### Mastra, Google ADK, and MCP Agent

These projects provide useful package-taxonomy references:

- Mastra separates core, evals, memory, workflows, adapters, observability, and
  provider integrations, but is much larger than this foundation;
- Google ADK uses a readable `core / integrations / samples / tests` split;
- MCP Agent separates executor, workflows, tracing, approval, CLI, and MCP
  concerns.

Adopted:

- keep core, adapters, testing, and CLI visibly separate;
- keep execution, tracing, approval, and workflow outside the measurement
  contract.

Rejected:

- copying platform-scale package categories before consumers exist;
- making MCP or a specific framework the repository's core abstraction.

### smolagents, Atomic Agents, and Axar

These projects provide minimal-layout evidence:

```text
agents/ models/ tools/ memory/ prompts/ core/ clients/ schema/
```

They confirm that a small runtime can be readable without a platform-scale
package graph. They do not provide the measured protocol boundaries, durable
workflow, or TypeScript/Bun constraints required here.

## Evaluation Framework References

- Pydantic Evals separates datasets, evaluators, online evaluation, and
  reporting.
- DeepEval separates metrics, models, datasets, evaluation, tracing, and
  integrations.
- Braintrust separates SDK packages, integrations, scenarios, and providers.
- OpenAI Evals and lm-evaluation-harness provide runner, solver, and task
  registry references.

These are useful for report and dataset design. They do not provide the exact
measurement identity, rubric, evidence owner, or gate semantics required by
issues #6 through #10.

## What the Current Runtime Adopted

The foundation runtime adopts:

- OpenAI Agents-style run loop, tool dispatch, event-trace shape, and scripted
  model tests;
- LangGraph-style checkpoints and explicit resume;
- Pydantic AI-style typed ports and structured output;
- a provider-neutral adapter boundary for future model/tool SDKs;
- separate execution and sandbox capability boundaries.

The runtime additionally makes these choices explicit:

- `RuntimeRun` is JSON-compatible and independent of framework sessions;
- pause is distinct from completion, failure, and cancellation;
- environment, model, tool, and protocol failures have separate categories;
- one conformance suite runs against the public `AgentRuntime` interface.

## Deferred Selection

The repository does not select a framework in the foundation change. The next
comparison may consider:

1. OpenAI Agents SDK JS: smallest direct TypeScript runtime path;
2. LangGraph: strongest durable-state and revision-loop reference;
3. Pydantic AI: strongest typed-agent and evaluation reference, with a Python
   boundary cost.

Vercel AI SDK is considered primarily for the model/tool adapter layer until a
runtime spike proves it should own more.

The selection gate is the conformance suite in `@lorelum/judge-testing`, not a
framework's own test report.
