# Agent Framework Survey

Reviewed on 2026-09-29. This is an architecture comparison for the proposed
JudgeAgent and engineering workflow, not a recommendation to adopt a framework
wholesale.

## Evaluation Criteria

The system has three different technical layers:

1. **Measurement protocol**: task, rubric, evidence, verdict, identity,
   calibration, and gate records.
2. **Agent runtime**: the execution loop, state, tools, events, cancellation,
   recovery, and model calls.
3. **Evaluation platform**: datasets, label management, reports, statistics,
   and regression tracking.

No single framework reviewed below owns all three cleanly. The main question is
therefore not "which framework is best", but "which layer should each framework
replace or influence".

The comparison uses these criteria:

- runtime abstractions: agent loop, tools, handoffs, state, recovery;
- durability: checkpoints, resume, retries, human approval, replay;
- provider neutrality: whether provider types or SDKs leak into core code;
- schema ownership: whether the framework can consume externally versioned
  contracts;
- testability: scripted models, deterministic execution, fixtures, snapshots;
- TypeScript and Bun fit;
- coupling risk: whether adopting it would force persisted artifacts to depend
  on framework types;
- fit for the proposed judge and the planner / implementer / revision workflow.

## Executive Result

The current package split remains valid:

```text
protocol -> runtime -> judge -> adapters / testing / cli
```

Framework candidates should be evaluated as implementations behind `runtime` or
`adapters`, not as the owner of `protocol` or `judge`.

The most relevant references are:

| Framework | Best use in our design | Do not use it for |
| --- | --- | --- |
| OpenAI Agents SDK JS | Lightweight runtime loop, handoffs, tracing, sessions | Measurement contract or rubric semantics |
| Pydantic AI | Typed agent design, capabilities, durable execution, eval lessons | Direct TypeScript core dependency |
| LangGraph | Durable graph state, checkpointing, revision loops | Rubric or scoring semantics |
| Mastra | TypeScript platform and package-boundary reference | A small initial core |
| Vercel Eve | Agent package taxonomy: sandbox, computer use, self-modification | Measurement protocol |
| Google ADK JS | Core versus integrations versus samples layout | Independently versioned judge contracts |
| smolagents | Minimal agent loop and code-agent reference | Production TS runtime |
| Atomic Agents | Typed input/output modules and small composition units | Full orchestration platform |
| Stirrup | Coding-agent workflow and tool organization | Measurement calibration |
| Axar | Very small TypeScript agent package layering | Production-ready runtime |
| MCP Agent | Executor, workflows, tracing, approval boundaries | General non-MCP runtime dependency |
| Vercel AI SDK | Provider/tool/streaming abstraction and TypeScript adapter shape | Judge or measurement ownership |
| Pydantic Evals / DeepEval / Braintrust | Evaluation dataset and report design references | Persisted judge identity and gate semantics |

## Runtime Candidates

### OpenAI Agents SDK

Repositories:

- `openai/openai-agents-python`
- `openai/openai-agents-js`

Observed architecture:

```text
packages/
  agents-core/
  agents-openai/
  agents-realtime/
  agents-extensions/
```

The Python package uses `src/agents` with explicit directories for `models`,
`memory`, `runner`, `sandbox`, `tracing`, and `run_internal`. The JavaScript
package separates the framework core from provider and realtime packages.

Strengths:

- Recognizable lightweight runtime primitives: agent, runner, tool, handoff,
  guardrail, session, run state, tracing.
- A clear core/provider split in the TypeScript monorepo.
- Scripted-model testing and run-state compatibility receive first-class
  attention.
- Handoff and guardrail abstractions fit an orchestrator plus specialized
  reviewer roles.

Risks:

- The SDK's agent and run types are runtime concerns, not stable measurement
  contracts.
- Sessions and run state are framework identities, not rubric or calibration
  identities.
- Its provider model may be convenient now and restrictive later if our
  protocol imports it.

Fit:

- Suitable as the first TypeScript runtime spike behind our ports.
- Unsuitable as a dependency of `@lorelum/judge-protocol` or `judge` domain
  rules.

### Pydantic AI

Repository: `pydantic/pydantic-ai`

Observed architecture:

```text
pydantic_ai_slim/pydantic_ai/
pydantic_graph/
pydantic_evals/
```

Inside the core package, responsibilities are split into `agent`,
`capabilities`, `durable_exec`, `models`, `providers`, `toolsets`, `ui`, and
`workspaces`. Provider integrations are separate modules.

Strengths:

- Strong typed interfaces and structured outputs.
- Capabilities and deferred tools are explicit extension points.
- Durable execution is separated from the base agent.
- Graphs and evaluations are separate packages, which is a useful boundary.
- Evaluation implementation is a valuable reference for datasets, evaluators,
  online evaluation, and reporting.

Risks:

- Python-first: adopting it directly would split the current Bun/TypeScript
  workspace across languages or add a service boundary.
- Its type system and runtime objects should not become our persisted
  measurement schema.
- The framework is larger than the first runtime we need.

Fit:

- Strong design reference for typed ports, capabilities, durable execution, and
  evaluation packaging.
- Candidate only if we deliberately choose a Python agent service.

### LangGraph

Repository: `langchain-ai/langgraph`

Observed architecture:

```text
libs/langgraph/langgraph/
  channels/
  graph/
  pregel/
  stream/
  managed/
```

LangGraph is built around graph nodes, channels, checkpoints, streaming, and
resumable execution.

Strengths:

- Best-in-class reference for durable state and resumable loops.
- The revision loop in the proposed workflow naturally maps to graph state.
- Explicit channels and checkpoints are relevant to recovery after failed
  tools or model calls.
- Separates the core graph library from checkpoint and SDK packages.

Risks:

- Graph concepts are heavier than the judge's per-criterion evaluation.
- It can encourage a workflow-first design where routing logic replaces a
  stable measurement contract.
- Persisting graph state itself is not enough; we still need rubric,
  evidence, instrument, and calibration identity.

Fit:

- Strong candidate for a durable engineering workflow adapter.
- Not a suitable measurement-contract layer.

### Mastra

Repository: `mastra-ai/mastra`

Observed architecture:

It is a very broad TypeScript monorepo with packages for agents, evals, memory,
RAG, workflows, server adapters, browser integrations, deployers, workspaces,
observability, and voice.

Strengths:

- Demonstrates a mature package split for TypeScript agent platforms.
- Includes explicit `packages/evals`, `packages/core`, `packages/schema-compat`,
  server adapters, and workspace adapters.
- Useful reference for separating provider integrations from core packages.

Risks:

- The repository is far larger than our required foundation.
- Its directory layout reflects a commercial platform, not a small evaluation
  agent.
- Copying all platform categories would create packages without current
  consumers.

Fit:

- Use as a reference for package growth and adapter boundaries.
- Do not use as the initial runtime or directory template.

### Vercel Eve

Repository: `vercel/eve`

Observed architecture:

```text
apps/
  benchmarks/
  docs/
  fixtures/
  frameworks/
  templates/
packages/
  eve/
  eve-code/
  eve-computer-use/
  eve-self-modification/
```

Strengths:

- Clear separation between core agent, code execution, computer use, and
  self-modification.
- Documents sandbox, skills, subagents, memory, protocols, and evals as
  distinct concerns.
- Useful reference for keeping a coding agent's execution environment out of
  the core reasoning loop.

Risks:

- Newer and broader than the measurement layer.
- Package categories are product capabilities, not all relevant to us.
- Self-modification and computer use are outside the current scope.

Fit:

- Reference for sandbox, skills, subagents, and capability package boundaries.
- Not a measurement or calibration framework.

### Google ADK for TypeScript

Repository: `google/adk-js`

Observed architecture:

```text
core/
integrations/
samples/
tests/
```

Strengths:

- A small top-level split that is easy to understand.
- Core, integrations, samples, and tests are explicit.
- Good reference for keeping provider integrations outside the runtime core.

Risks:

- Younger TypeScript implementation.
- Less relevant to measurement identity and statistical calibration.
- The core API is still framework-owned.

Fit:

- Directory reference and possible runtime comparison candidate.
- Not a protocol dependency.

### smolagents

Repository: `huggingface/smolagents`

Observed architecture:

```text
src/smolagents/
  agents.py
  models.py
  tools.py
  memory.py
  prompts/
```

Strengths:

- Minimal, understandable agent loop.
- Code-agent execution is a useful reference for tool and sandbox design.
- Low abstraction overhead.

Risks:

- Python only.
- Fewer versioned protocol boundaries.
- Not designed as a durable engineering workflow.

Fit:

- Good baseline for understanding the smallest viable runtime.
- Not the runtime base for the current repository.

### Atomic Agents

Repository: `Eigenwise/atomic-agents`

Observed architecture:

```text
atomic-agents/
  agents/
  base/
  connectors/
  context/
  utils/
```

Strengths:

- Small composition units.
- Explicit base schemas for input and output.
- Tools, prompts, resources, and context are distinct concepts.

Risks:

- Python.
- Schema ownership remains inside the framework.
- Does not solve measurement identity or calibration.

Fit:

- Useful reference for small typed units and module naming.
- Not a direct dependency.

### Stirrup

Repository: `ArtificialAnalysis/Stirrup`

Observed architecture:

```text
src/stirrup/
  clients/
  core/
  integrations/
  prompts/
  skills/
  tools/
  utils/
```

Strengths:

- Focused on coding-agent work rather than general chat.
- Clear separation of model clients, core agent, prompts, skills, and tools.
- Small enough to inspect completely.

Risks:

- Python.
- No measurement-contract or calibration layer.
- Uses a generic `utils` directory that should not be copied blindly.

Fit:

- Useful domain reference for coding-agent workflow and tool organization.
- Not the judge measurement layer.

### Axar

Repository: `axar-ai/axar`

Observed architecture:

```text
src/
  agent/
  common/
  llm/
  schema/
```

Strengths:

- Very small TypeScript structure.
- Agent, LLM, and schema are visibly separated.
- Easy to understand as a starting point.

Risks:

- Too small for durable state, approvals, recovery, or calibration.
- Not enough evidence of long-term compatibility or extension boundaries.

Fit:

- Reference for minimal TypeScript folder names.
- Not a production runtime choice.

### MCP Agent

Repository: `lastmile-ai/mcp-agent`

Observed architecture:

```text
src/mcp_agent/
  agents/
  cli/
  core/
  executor/
  human_input/
  logging/
  mcp/
  server/
  telemetry/
  tracing/
  workflows/
```

Strengths:

- Explicit executor, workflow, logging, tracing, and human-input boundaries.
- Strong reference for approval and durable workflow concerns.
- Separate CLI from runtime core.

Risks:

- MCP-centric.
- Python.
- Framework workflows should not own judge measurement semantics.

Fit:

- Reference for executor, tracing, and approval boundaries.
- Not a general runtime dependency.

### Vercel AI SDK

Repository: `vercel/ai`

Observed architecture:

The monorepo separates the main `ai` package, provider packages, framework
integrations, observability, MCP, sandbox packages, and agent harnesses.

Strengths:

- Excellent TypeScript provider abstraction.
- Strong streaming, tool-call, schema, and UI integration boundaries.
- Useful provider adapter reference.

Risks:

- Not a complete agent runtime or durable workflow.
- It should not define our measurement records.

Fit:

- Candidate dependency for model and tool adapters.
- Not a candidate for `protocol` or judge domain rules.

## Evaluation Framework References

### Pydantic Evals

Separates datasets, evaluators, online evaluation, reporting, and OpenTelemetry.
It is a strong reference for evaluator interfaces and reports, but it does not
provide the measurement identity and gate semantics needed by `#227`.

### DeepEval

Separates metrics, models, datasets, evaluation, tracing, and integrations. Its
metric taxonomy is useful, but the framework owns the metric model and is
Python-first.

### Braintrust SDK

Separates JavaScript packages, integrations, e2e scenarios, and provider
adapters. Useful for experiment and observability design, but its hosted
platform concepts should not enter the protocol.

### OpenAI Evals and lm-evaluation-harness

Useful references for task registries, completions, solvers, and evaluation
runners. They are benchmark-runner shaped, not a durable agent or measurement
identity system.

## Fit Against the Proposed Issues

| Proposed area | Framework evidence | Framework boundary |
| --- | --- | --- |
| Measurement definition and identity | None provides the exact contract | Own it in `packages/protocol` |
| Evidence and prompt projection | OpenAI Agents and Pydantic AI have run contexts, not evidence contracts | Own it in `protocol` plus `judge` |
| Rubric authoring | Pydantic Evals and DeepEval have metrics, not task-contract rubrics | Own it in `judge` workflows |
| Judge execution | OpenAI Agents JS and Pydantic AI can execute model calls | Implement behind runtime ports |
| Calibration | Pydantic Evals, DeepEval, Braintrust provide reports | Own identity, labels, and gate policy |
| Revision loop | LangGraph is the strongest durability reference | Optional runtime/workflow adapter |
| Provider adapters | Vercel AI SDK, OpenAI Agents providers, Pydantic providers | Keep inside `packages/adapters` |
| Sandbox and coding tools | Vercel Eve, Stirrup, OpenAI Agents sandbox | Separate execution adapter package |
| Testing kit | OpenAI Agents scripted model is the best reference | Own it in `packages/testing` |

## Directory Patterns Worth Considering

### Pattern A: Framework-neutral core

```text
packages/
  protocol/
  runtime/
  judge/
  testing/
  adapters/
```

This is the current structure. It keeps framework dependencies outside the
measurement boundary. The main disadvantage is that runtime work has to define
its own minimal contracts before a framework is selected.

### Pattern B: Runtime adapter packages

```text
packages/
  protocol/
  runtime/
  judge/
  runtime-openai-agents/
  runtime-langgraph/
  adapters/
```

This makes competing runtime experiments visible, but each runtime package
needs its own compatibility and release policy. It is appropriate only if more
than one runtime will be supported.

### Pattern C: Platform package taxonomy

```text
packages/
  agents/
  workflows/
  evals/
  memory/
  mcp/
  sandboxes/
  observability/
```

This resembles Mastra and Vercel Eve. It is useful for a platform with many
independent capabilities, but it is too broad for the current measurement-layer
problem.

### Pattern D: Python core plus TypeScript facade

```text
python/
  judge_core/
  workflows/
typescript/
  protocol/
  client/
```

This would make Pydantic AI, LangGraph, and the Python evaluation ecosystem
more natural. It introduces a language and deployment boundary that is not
justified until the runtime proves it needs Python-only durability or model
features.

## Recommended Evaluation Shortlist

For the next runtime spike, compare at most three implementations against the
same tiny judge workflow:

1. **OpenAI Agents SDK JS**: smallest direct TypeScript runtime path.
2. **LangGraph**: strongest durable-state and revision-loop reference.
3. **Pydantic AI**: strongest typed-agent and evaluation-reference design, with
   the explicit cost of a Python boundary.

Use Vercel AI SDK only for the model/tool adapter layer unless the runtime spike
shows that its agent harness directly solves a measured problem.

## Directory Decision Needed

The user needs to choose among these decisions before implementation:

1. Is the runtime strictly TypeScript/Bun, or may a Python service own durable
   workflow execution?
2. Should agent-framework adapters live under `packages/adapters`, or receive
   separate `packages/runtime-*` packages?
3. Does `judge` own the revision workflow, or is revision a separate
   `packages/workflow` or `apps/` concern?
4. Should the testing kit remain a public package, or become a subpath of a
   single umbrella package?
5. Are provider adapters one package initially, or one package per provider
   from the start?
