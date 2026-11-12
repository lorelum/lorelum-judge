# @lorelum/judge-workflow

Provides in-memory, host-driven task planning via a provider-neutral `ModelPort`.
Planning is implemented; implementation, revision execution, delivery, budgets and
long-running orchestration are not implemented by this package.

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

`generate({ model, runId, signal, instructions?, config? })` asks the model for a
proposal with no tools; it accepts a JSON message or structured response, validates
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
const proposal = await session.generate({ model, runId: "planning-1", signal });
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
cannot overwrite a later input or state change. The host is responsible for reporting
new material and conflicts and for supplying genuine user decisions: the model cannot
authenticate the user or approve its own work.

State is held only in the session instance. There is no persistence, recovery,
identity authentication, sandbox, independent verification of source truth, or
operational authorization. Keep the session under host control; a model and its
source text are untrusted. No external provider or API key is bundled.
