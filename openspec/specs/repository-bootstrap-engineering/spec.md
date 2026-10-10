# repository-bootstrap-engineering Specification

## Purpose
Define the minimum repository baseline that allows a fresh clone to be installed
and validated and requires later contract-class work to pass an issue, OpenSpec,
and pull-request gate.

## Requirements

### Requirement: Fresh clone is reproducible

The repository MUST declare one package manager and lockfile policy, and a fresh
clone MUST be installable with `bun install --frozen-lockfile`. The root
`validate` command MUST fail with a non-zero exit status when any declared check
fails.

#### Scenario: Frozen install succeeds

- **WHEN** a reviewer clones the repository without local dependencies
- **THEN** `bun install --frozen-lockfile` succeeds using the committed lockfile

#### Scenario: Validation fails closed

- **WHEN** any formatting, type, test, or build check fails
- **THEN** the root `validate` command exits non-zero and identifies the failed
  check

### Requirement: CI uses the local validation contract

The CI workflow MUST run on pull requests and pushes to `main`, MUST use the same
pinned package-manager version as the root manifest, and MUST invoke the same
root validation entry point used locally.

#### Scenario: Local and CI parity

- **WHEN** a pull request changes the repository
- **THEN** CI installs from the committed lockfile and runs `bun run validate`

### Requirement: Repository governance is reviewable

The repository MUST document contribution, security reporting, repository
rules, issue creation, and pull-request requirements. Contract-class changes
MUST have a linked issue and an OpenSpec change before implementation.
Contained fixes that do not alter contracts MAY use the direct pull-request path
when the PR body states the root cause, fix boundary, and verification.

#### Scenario: Contract-class gate exists

- **WHEN** a contributor proposes a protocol, interface, schema, runtime, or
  evaluation-semantics change
- **THEN** the contribution guide requires an issue and OpenSpec change before
  implementation

#### Scenario: Contained fix can use the direct path

- **WHEN** a contributor makes a documentation or tooling correction that does
  not alter a contract
- **THEN** the contributing guide allows a direct PR with root cause, boundary,
  and verification

### Requirement: Pull requests are scoped and verifiable

Every pull request MUST declare one scope, link the issue it resolves, list the
commands actually run, state the scenarios exercised, and disclose material AI
assistance and its review findings.

#### Scenario: Cold reviewer can verify

- **WHEN** a reviewer who has not read the issue discussion opens a pull request
- **THEN** the body explains what changed, what did not change, how to reproduce
  verification, and what was deliberately deferred

### Requirement: The bootstrap change does not migrate product code

This change MUST NOT add protocol, runtime, judge, workflow, provider, benchmark,
or task-specific implementation. Those boundaries MUST land through their own
issues and changes.

#### Scenario: Foundation remains separable

- **WHEN** the bootstrap change is reviewed
- **THEN** its diff contains repository tooling, governance, CI, templates, and
  OpenSpec artifacts only
