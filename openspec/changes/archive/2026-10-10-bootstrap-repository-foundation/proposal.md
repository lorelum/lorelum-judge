## Why

`main` currently contains only a minimal README. A fresh clone cannot install,
validate, test, or build the repository, and there is no issue or OpenSpec record
for the foundation that was previously assembled in a reference branch.

This change establishes the repository baseline required by #2 without treating
the historical seed commit as an implicit deliverable.

## What Changes

- Add a Bun-based root workspace with exact local and CI tool versions.
- Add the repository validation commands and a scheduled-independent CI workflow.
- Add repository governance, contribution, security, issue, and pull-request
  templates.
- Add the OpenSpec and issue/PR gate used by later contract-class changes.

## Capabilities

### New Capabilities

- `repository-bootstrap-engineering`: defines reproducible local validation, CI
  parity, repository governance, and the required change gate.

### Modified Capabilities

None.

## Impact

- Root workspace manifests and tool configuration.
- CI and repository templates.
- Governance documentation.
- OpenSpec process files.

No protocol, runtime, judge, workflow, provider, or benchmark semantics are
introduced by this change.
