# @lorelum/judge-workflow

Provides in-memory, host-driven task planning and a controlled single-run
execution loop via provider-neutral ports. Delivery, long-running revision and
cross-process recovery are not implemented by this package.

## Controlled execution status

The package provides host-owned candidate discovery and a single-use action
session with independent evidence and public judge integration.
`discoverWorkspace` lists tracked, modified, deleted and untracked Git paths,
including ignored files. Supply explicit per-file exclusions with reasons; the
host must review all included material for sensitive content. Discovery and
the resulting hashes are not permission to disclose those files to a model.
Discovery and snapshotting require the Linux `openat2` source helper; if the
helper or kernel support is unavailable they fail closed. Source root device and
inode and the reviewed file contents are bound into the host candidate identity.
The returned review retains a live root descriptor and cannot be reconstructed
from JSON. Pass that original review to the session; call
`closeWorkspaceReview(review)` if abandoning it. A session closes its root
descriptor after execution, so the review cannot then be reused.
Git HEAD, index facts and local configuration are identified and rechecked around
discovery and snapshotting. This detects observable changes, but is not an atomic
Git metadata snapshot and does not prove resistance to transient malicious changes.

`ControlledExecutionSession` requires a current confirmed `PlanningSession`
and a separate host `authorize` call over the exact permission identity. Its
structured model actions can read and write only approved paths, require an
expected old-content hash for writes, and never write back to the source project.
Writes are staged in a private temporary file; the target's previous content and
current authorization are rechecked immediately before atomic replacement.
Cancelled or conflicting writes remove the staged file without replacing the target.
Plan invalidation, revocation, expiration and cancellation stop subsequent actions.
The host must keep these objects and the snapshot under its own control.

For a program-based judge review, the trusted host must also pass the exact
`verification.review.ports.checker` function as the fourth `authorize` argument.
Its declared checker identity is part of the approved verification configuration;
the live function is bound by object identity and cannot be supplied by a model
or reconstructed from JSON. The checker is trusted host code, not sandboxed
candidate code, and must honor the supplied cancellation signal.

Approved commands are executed through the injected sandbox. The supported hard
limits cover time, model/action/command counts and output; requesting file-byte,
memory or cost limits is rejected rather than silently ignored. If a separately
approved verification configuration is supplied, the session copies the stopped
candidate into an independent runner, runs authorized checks and invokes the
public judge review. Success and early failures attempt to construct a validated
protocol record chain, with missing evidence marked unknown or not started.
The Linux bubblewrap consumer example exercises the complete path with a real
temporary Git project and deterministic model; unsupported environments fail
closed. Completion is not a quality verdict or permission to deliver.

## Planning

Create `new PlanningSession(planId, { task, sources })` with versioned
`WorkflowSource` records and either a complete protocol `TaskContract` or a
`CandidateTask` containing only `schema`, `id`, `taskClass` and `text`. In the
latter mode the model proposes acceptance criteria: `review().acceptanceProposed`
is true and the host must present those criteria as proposals, not as requirements
already asserted by the user. Every proposed criterion must reference an available
host-provided source. Candidate origin labels are constrained by source kind; a
model cannot assert a prior user decision. References alone do not establish that
the source actually supports the proposed text: the user must review it.

Before planning, the trusted host must obtain a user disclosure decision for the
current task and sources to the intended model, then call
`grantModelDisclosure(model)` and pass its identity as `disclosureIdentity` to
`generate`. The grant is bound to that model object and the current premises;
changed inputs or `revokeModelDisclosure()` invalidate it.
`generate({ model, runId, signal, disclosureIdentity, instructions?, config? })`
asks the model for a proposal with no tools; it accepts a JSON message or structured response, validates
the complete protocol plan and provenance, and rejects changes to the supplied task
metadata, fixed acceptance criteria, sources, ID or revision. `review()` returns a
detached snapshot including the full plan, identity, revision, status, eligibility
and `operationAuthorized: false`. Errors are returned
as `PlanningResult` with validation issues, the original model/input error, or a
state/response explanation. Invalid constructor input throws.

The host presents that review to the user. Only an explicit host call to
`confirm(identity, revision)` can confirm the exact displayed draft. Unresolved
conflicts prevent confirmation. `isEligible(identity, revision)` checks that exact
confirmation; eligibility means only that the plan is confirmed, **not** that
network access, installation, credentials, file changes, command execution, review,
commit, push, release or deployment are authorized.

```ts
import { PlanningSession } from "@lorelum/judge-workflow";

// task, sources and model are supplied by the host.
const session = new PlanningSession("plan-1", { task, sources });
const disclosureIdentity = session.grantModelDisclosure(model);
const proposal = await session.generate({ model, runId: "planning-1", signal, disclosureIdentity });
if (!proposal.ok) throw proposal.error;

// Present proposal.value to the user. Only after the user explicitly confirms
// that exact review may the host call:
const decision = session.confirm(proposal.value.identity, proposal.value.revision);
if (!decision.ok) throw decision.error;
const confirmed = session.isEligible(proposal.value.identity, proposal.value.revision);
// confirmed does not grant permission to execute any operation.
```

To request proposed acceptance criteria instead, supply task metadata without
`acceptance`, for example:

```ts
const task = {
  schema: "lorelum.judge.task-contract/v1" as const,
  id: "task-1",
  taskClass: "cli",
  text: "Add JSON output",
};
const session = new PlanningSession("plan-1", { task, sources });
// Generate and review as above; acceptanceProposed is true.
```

In candidate mode a later `generate` with user adjustment instructions may propose
different criteria. With a complete TaskContract, criteria remain fixed unless the
host explicitly replaces the input task via `updateInputs`.

Call `generate` with user instructions to request a revised proposal. Starting a
generation invalidates any prior confirmation, even when generation fails; a new
proposal must be reviewed and confirmed again. Use `updateInputs({ task, sources })`
when requirements or source content, versions or availability change. This preserves
the old review but invalidates it until a new proposal is generated and confirmed;
unchanged inputs do not invalidate. Conflicting material must remain visible in the
proposal and be resolved by the user before confirmation. `revoke()` withdraws a
confirmation; `invalidate()` marks existing premises invalid. An in-flight response
or reentrant response property cannot overwrite a later input or state change, or
publish a plan after cancellation. The host is responsible for reporting new
material and conflicts and supplying genuine user decisions; the model cannot
authenticate the user or approve its own work.

State is held only in the session instance. There is no persistence, recovery,
identity authentication, sandbox, independent verification of source truth, or
operational authorization. Keep the session under host control; a model and its
source text are untrusted. No external provider or API key is bundled.
