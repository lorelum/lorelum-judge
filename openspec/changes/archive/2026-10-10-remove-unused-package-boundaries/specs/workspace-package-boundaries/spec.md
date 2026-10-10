## MODIFIED Requirements

### Requirement: Core package boundaries have one owner

The workspace MUST define separate core packages for protocol, runtime, judge,
workflow, and testing. Each package MUST have one package name, one public
entrypoint, and a README that states its responsibility and exclusions.

#### Scenario: New contract has one owner

- **WHEN** a contributor adds a new public type or behavior
- **THEN** the contribution guide and package README identify exactly one owning
  package and do not require editing unrelated package entrypoints

#### Scenario: Empty boundary is not a behavior claim

- **WHEN** a core package has no implementation yet
- **THEN** its entrypoint remains a no-op export and its README names the issue
  or change that will add behavior

#### Scenario: No package without implementation and consumer

- **WHEN** the workspace is reviewed
- **THEN** no `apps/*` workspace and no `packages/adapters` package exist

### Requirement: Dependency direction is executable

The allowed dependency graph MUST be:

```text
protocol -> none
runtime -> protocol
judge -> protocol, runtime
workflow -> protocol, runtime, judge
testing -> protocol, runtime, judge
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

#### Scenario: Removed package fails closed

- **WHEN** a workspace package named `@lorelum/judge-adapters` or
  `@lorelum/judge-cli` is discovered
- **THEN** the layer check exits non-zero because it has no dependency policy

## REMOVED Requirements

None. The `Cross-package imports use public entrypoints`, `The layer check is
deterministic and in the repository gate`, and `Integration packages are delayed
until implementation` requirements are unchanged.
