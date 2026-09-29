## 1. Issue, OpenSpec, and Initial PR

- [x] 1.1 Confirm issue #4 owns only framework-neutral runtime behavior.
- [x] 1.2 Add the OpenSpec proposal, design, tasks, and specification.
- [x] 1.3 Validate the change with OpenSpec strict validation.
- [ ] 1.4 Create the initial PR with OpenSpec artifacts only.

## 2. Runtime Ports and Contracts

- [ ] 2.1 Define model, tool, execution, storage, clock, and telemetry ports.
- [ ] 2.2 Define JSON-compatible messages, tool calls, errors, events, state,
  and run records.
- [ ] 2.3 Define cancellation and runtime failure categories.
- [ ] 2.4 Export only public runtime contracts from the package entrypoint.

## 3. Reference Runtime

- [ ] 3.1 Implement the reference runtime loop.
- [ ] 3.2 Persist state after each completed step.
- [ ] 3.3 Implement resume from persisted state.
- [ ] 3.4 Handle text, tool-call, structured-output, cancellation, and failure
  paths deterministically.

## 4. Test Kit and Conformance

- [ ] 4.1 Add scripted model, in-memory store, deterministic clock, and
  recording telemetry.
- [ ] 4.2 Add a reusable conformance runner that accepts an `AgentRuntime`.
- [ ] 4.3 Run the conformance runner against the reference runtime.
- [ ] 4.4 Add focused failure-category and resume tests.

## 5. Verification and Review

- [ ] 5.1 Run `bun install --frozen-lockfile` and `bun run validate`.
- [ ] 5.2 Run OpenSpec strict validation.
- [ ] 5.3 Read back the PR and record AI review findings and resolution.
- [ ] 5.4 Update the PR body with commands, results, and deferred framework
  adapter work.
