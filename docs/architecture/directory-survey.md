# Directory Survey

This document records the repository-layout patterns reviewed before freezing
the initial structure.

## Sources

The survey covers lightweight agent frameworks, production TypeScript agent
packages, and evaluation systems:

- OpenAI Agents Python and TypeScript
- Hugging Face smolagents
- Pydantic AI and Pydantic Evals
- Mastra
- Atomic Agents
- Stirrup
- Axar
- MCP Agent
- LangGraph
- ModelScope MS-Agent
- DeepEval

The goal is to identify stable repository conventions. It is not a framework
selection or an endorsement.

## Patterns

### Small, single-package projects

Projects such as smolagents, Stirrup, Axar, and Atomic Agents keep one source
package and split it by domain responsibility. Their usual source directories
are:

```text
agents/ models/ tools/ memory/ prompts/ utils/ core/ clients/
```

This is useful evidence for module shape, but Lorelum Judge already has
different likely consumers: protocol-only fixtures, an embedding runtime,
provider adapters, a test kit, and a CLI. Those are real boundary candidates,
so this repository starts as a small workspace instead of a single source root.

### Mature multi-provider projects

OpenAI Agents JS, Pydantic AI, and Mastra split code into packages when they
have independent release cadence, provider SDK isolation, or platform-specific
runtime requirements. Their recurring split is:

```text
core / provider adapters / extensions / realtime or platform packages
```

The workspace mirrors that split, but only `protocol` is populated at the
foundation stage. Empty package directories are not expected to become release
artifacts until their contracts and compatibility policies are established.

### Evaluation projects

Pydantic Evals, DeepEval, OpenAI Evals, and lm-evaluation-harness separate:

```text
task or dataset / evaluator or metric / model or provider / reporting / runner
```

For Lorelum Judge, the corresponding domains are task contract, rubric,
evidence, measurement, calibration, gate, and workflow. A generic `utils/`
directory must not become the place where those responsibilities are mixed.

### Repository-level conventions

Across the surveyed repositories, the stable top-level directories are:

```text
.github/  docs/  examples/  scripts/  src/  tests/  schemas/
```

Prompt assets are either versioned in a `prompts/` directory or beside the
workflow that owns them. Persisted schemas and generated fixtures are kept
outside the main source tree when they are public contracts.

## Decisions

1. Start as a Bun workspace with `protocol`, `runtime`, `judge`, `workflow`,
   `testing`, `adapters`, and `apps/cli` as explicit boundaries.
2. Keep `protocol`, `runtime`, domain rules, and ports framework-independent.
3. Add `examples/` because public usage must be executable without benchmark
   fixtures.
4. Use `packages/testing` and export `@lorelum/judge-testing` for scripted
   models, in-memory evidence stores, and deterministic clocks.
5. Keep prompt templates in `prompts/`, with a compiler that records template,
   variable, protocol, and rendering identity.
6. Keep generated JSON Schema under `schemas/`; TypeBox definitions remain the
   source of truth.
7. Reserve all package boundaries now, but populate a package only when its
   public contract is stable. Do not let adapters or provider SDKs leak into
   `protocol`, `runtime`, or `judge`.
8. Framework implementations use `packages/runtime-*`; concrete provider SDKs
   use `packages/provider-*`.
9. Do not add a generic `utils/` package. Shared primitives belong in
   `foundation/`; domain-specific behavior stays in its owning module.
