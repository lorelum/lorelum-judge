# Workspace Package Boundaries Specification

## Purpose

Define ownership and dependency rules for the core evaluation-agent workspace,
and make violations fail the repository validation gate.

## ADDED Requirements

### Requirement: Core package boundaries have one owner

The workspace MUST define separate core packages for protocol, runtime, judge,
workflow, testing, and adapters, plus the CLI application boundary. Each package
MUST have one package name, one public entrypoint, and a README that states its
responsibility and exclusions.

#### Scenario: New contract has one owner

- **WHEN** a contributor adds a new public type or behavior
- **THEN** the contribution guide and package README identify exactly one owning
  package and do not require editing unrelated package entrypoints

#### Scenario: Empty boundary is not a behavior claim

- **WHEN** a core package has no implementation yet
- **THEN** its entrypoint remains a no-op export and its README names the issue
  or change that will add behavior

### Requirement: Dependency direction is executable

The allowed dependency graph MUST be:

```text
protocol -> none
runtime -> protocol
judge -> protocol, runtime
workflow -> protocol, runtime, judge
testing -> protocol, runtime, judge
adapters -> protocol, runtime
cli -> protocol, runtime, judge, workflow, adapters
```

`runtime-*` packages MAY depend on protocol and runtime. `provider-*` packages
MAY depend on protocol and runtime. No package may depend on a package in a
higher layer.

#### Scenario: Allowed edge passes

- **WHEN** a package imports an allowed workspace dependency declared as
  `workspace:*`
- **THEN** the layer check passes

#### Scenario: Reverse edge fails

- **WHEN** protocol imports runtime or judge
- **THEN** the layer check exits non-zero and reports the forbidden edge

### Requirement: Cross-package imports use public entrypoints

Source code inside one package MUST NOT use a relative import to reach another
package. Cross-package imports MUST use the target package name, and the target
MUST be declared in the source package manifest as `workspace:*`.

#### Scenario: Relative escape fails

- **WHEN** a source file imports `../../other-package/src/index`
- **THEN** the layer check exits non-zero and reports a cross-package relative
  import

#### Scenario: Missing declaration fails

- **WHEN** source code imports a workspace package without declaring it in
  `package.json`
- **THEN** the layer check exits non-zero

### Requirement: The layer check is deterministic and in the repository gate

The root validation command MUST include the layer check. It MUST run without a
model, provider, network, or generated artifact and MUST fail closed when it
discovers a workspace package without a dependency policy.

#### Scenario: Local gate catches a violation

- **WHEN** a contributor introduces an illegal package dependency and runs
  `bun run validate`
- **THEN** the command exits non-zero before the change can be reviewed as valid

### Requirement: Integration packages are delayed until implementation

The repository MUST reserve `runtime-*` for framework runtime implementations
and `provider-*` for concrete provider SDK implementations. This change MUST NOT
create those packages without a real implementation, and production packages
MUST NOT depend on `testing`.

#### Scenario: No placeholder framework package

- **WHEN** this change is reviewed
- **THEN** no `packages/runtime-*` or `packages/provider-*` directory is created

#### Scenario: Production cannot consume the test kit

- **WHEN** a production package imports `@lorelum/judge-testing`
- **THEN** the layer check rejects the dependency
