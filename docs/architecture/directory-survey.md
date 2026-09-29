# Directory Survey

Status: repository-layout evidence for the foundation.

Reviewed: 2026-09-29.

## Sources

The survey covers lightweight agent projects, production TypeScript agent
platforms, and evaluation systems:

- OpenAI Agents Python and TypeScript;
- Hugging Face smolagents;
- Pydantic AI and Pydantic Evals;
- LangGraph;
- Mastra;
- Atomic Agents;
- Stirrup;
- Axar;
- Vercel Eve;
- Google ADK for TypeScript;
- MCP Agent;
- DeepEval and Braintrust.

The goal is to identify stable directory conventions, not to endorse a
framework or copy a full platform taxonomy.

## Observed Pattern A: Small Single-Package Projects

Projects such as smolagents, Stirrup, Axar, and Atomic Agents keep one source
package and split it by domain:

```text
agents/ models/ tools/ memory/ prompts/ core/ clients/ schema/
```

Useful evidence:

- the core loop can remain readable without many packages;
- tools, models, memory, and prompts are distinct concepts;
- generic `utils/` directories are a common place for responsibilities to lose
  ownership.

Not sufficient here:

- the repository needs protocol-only consumers, a runtime boundary, provider
  adapters, a test kit, and a CLI;
- those consumers have independent compatibility and release concerns.

## Observed Pattern B: Mature Multi-Provider Monorepos

OpenAI Agents, Pydantic AI, Mastra, and Vercel AI split packages when there is
an independent release cadence, provider SDK isolation, or a platform-specific
runtime requirement.

Recurring split:

```text
core / provider adapters / extensions / runtime or platform packages
```

Adopted:

- core contracts remain separate from provider integrations;
- framework-specific runtime code gets its own package name;
- provider SDK types stay outside the core;
- integration packages are created only when an implementation exists.

Rejected:

- creating every platform package before it has a consumer;
- putting rubric, eval, memory, sandbox, and observability into one generic
  core.

## Observed Pattern C: Evaluation Projects

Pydantic Evals, DeepEval, OpenAI Evals, and lm-evaluation-harness separate:

```text
dataset or task / evaluator or metric / model or provider / reporting / runner
```

For Lorelum Judge, the corresponding concepts are task contract, rubric,
evidence, measurement, calibration, gate, and workflow.

Adopted:

- measurement is not the same thing as a benchmark fixture;
- evaluator results and reporting should be separable from model execution;
- task inputs, evidence, and judgments need explicit identity.

Rejected:

- making a generic metric object the persisted measurement contract;
- mixing benchmark runner state with judge runtime state.

## Repository-Level Conventions

Across the reviewed projects, stable top-level directories are:

```text
.github/ docs/ examples/ scripts/ src/ tests/ schemas/
```

For a workspace repository, the same conventions map to:

```text
.github/
apps/
docs/
packages/
scripts/
tests/
openspec/
```

Adopted:

- `.github/` owns automation and collaboration templates;
- `docs/` owns architecture, decisions, guides, and review material;
- `scripts/` owns deterministic repository checks, not product behavior;
- `tests/` owns cross-package contract and integration tests;
- package-local tests stay beside their package.

Deferred:

- `examples/`, `prompts/`, and `schemas/` are added when a real public usage,
  prompt compiler, or generated schema exists;
- placeholder directories are not created without a consumer.

## Current Repository Tree

```text
lorelum-judge/
├── apps/
│   └── cli/                 @lorelum/judge-cli
├── packages/
│   ├── protocol/            @lorelum/judge-protocol
│   ├── runtime/             @lorelum/judge-runtime
│   ├── judge/               @lorelum/judge
│   ├── workflow/            @lorelum/judge-workflow
│   ├── testing/             @lorelum/judge-testing
│   └── adapters/            @lorelum/judge-adapters
├── docs/
│   ├── architecture/
│   └── decisions/
├── openspec/
│   └── changes/
├── scripts/
├── tests/
└── .github/
```

## Dependency Convention

```text
protocol -> none
runtime  -> protocol
judge    -> protocol, runtime
workflow -> protocol, runtime, judge
testing  -> protocol, runtime, judge
adapters -> protocol, runtime
cli      -> protocol, runtime, judge, workflow, adapters
```

Framework implementations use `packages/runtime-*`. Concrete provider SDKs use
`packages/provider-*`. They are created only after a real implementation and
must implement the same public ports.

## Layout Decisions

1. Start as a Bun workspace because protocol consumers, runtime consumers,
   provider adapters, testing helpers, and the CLI have different compatibility
   needs.
2. Keep protocol, runtime, domain rules, and ports framework-independent.
3. Keep `workflow` separate from `judge` so revision control does not become
   measurement semantics.
4. Keep `testing` private until its API and compatibility policy stabilize.
5. Keep provider-neutral infrastructure in `adapters`; split provider SDKs
   when their dependencies or release cadence require it.
6. Do not copy a commercial platform taxonomy such as
   `agents/evals/memory/mcp/sandboxes/observability` before those capabilities
   exist.
7. Do not use a generic `utils` package for cross-cutting domain behavior.
