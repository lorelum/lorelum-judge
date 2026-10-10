## Context

The repository was created from a minimal initial commit. A reference branch
contains prior investigation, but it is not part of `main` and must not be
merged wholesale. This change creates only the engineering baseline needed to
allow later work to be delivered through issues, OpenSpec artifacts, and pull
requests.

## Goals / Non-Goals

**Goals:**

- Make a fresh clone reproducible with one package manager and one validation
  command.
- Make CI run the same install and validation commands as local development.
- Record the repository's contribution, security, issue, and review gates.
- Establish OpenSpec as the required design artifact for contract-class changes.

**Non-Goals:**

- Do not define protocol, measurement, runtime, or workflow behavior.
- Do not select an Agent framework or provider SDK.
- Do not create packages whose only purpose is to reserve a future name.
- Do not merge or rewrite the historical `seed/foundation-baseline` branch.

## Decisions

### One workspace and one validation entry point

Use a private root package with Bun workspaces and a single `validate` script.
The script is the local and CI gate. Individual checks may be added later by
their owning changes, but they must remain reachable from `validate`.

### Exact runtime version

Pin a concrete Bun version in `packageManager` and CI instead of relying on the
runner default. The root `engines` range documents the minimum supported local
runtime; CI uses the exact pinned version.

### Governance before implementation

Add `AGENTS.md`, `CONTRIBUTING.md`, issue templates, and the PR template before
package implementation. Contract-class work must cite an issue and an OpenSpec
change; contained documentation or tooling fixes may go directly to a PR when
the body states the root cause, boundary, and verification.

### Deliberately small first baseline

The first implementation adds no product source packages. It creates the root
tooling and policy needed for #3 and #4 to land independently. This avoids
turning the bootstrap change into a disguised migration.

## Risks / Trade-offs

- [Adding too many placeholder packages would create false architecture] ->
  Keep the workspace empty until a package has a real contract and consumer.
- [Local and CI commands could diverge] -> CI invokes the same `bun run validate`
  entry point after a frozen-lockfile install.
- [Formatting could fail in a fresh checkout because files were generated on
  Windows] -> Normalize line endings and verify from a clean clone-like checkout.
- [The process could become too heavy for contained fixes] -> Keep a direct PR
  path for non-contract corrections and name it in `CONTRIBUTING.md`.

## Migration Plan

1. Create the issue, OpenSpec change, and an initial pull request containing only
   OpenSpec artifacts and process constraints.
2. Add the root workspace, tool configuration, and validation commands.
3. Add CI, governance documents, and templates.
4. Run an install in a clean lockfile state and execute every validation command.
5. Record the commands and evidence in the PR, then request review.

Rollback is deleting the change's files and reverting the branch; `main` has no
product implementation to unwind.

## Open Questions

None that block this change.
