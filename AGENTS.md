# Repository Rules

- Write collaborator-facing issues, pull requests, and review comments in
  Chinese unless the request or repository policy says otherwise. Keep paths,
  commands, code identifiers, and error messages in their original spelling.
- `main` changes through pull requests. Keep each pull request within one
  declared scope and link the issue it resolves.
- Contract-class changes require a converging GitHub issue and an OpenSpec
  change before implementation. This includes public schemas, package
  interfaces, runtime contracts, evaluation semantics, persisted records, and
  pipeline gates.
- Contained documentation or tooling fixes that do not alter contract behavior
  may use a direct pull request. The body must state the root cause, fix
  boundary, and exact verification.
- One change keeps one long-lived branch and one pull request. Add review fixes
  as new commits rather than rewriting published history.
- Run the repository validation command before requesting review. Record the
  verbatim commands, observed results, and any deliberately unexecuted check in
  the pull request.
- Contract-class pull requests must disclose material AI assistance, list AI
  review findings, and state how each finding was resolved or why it was
  rejected.
- Reopen the saved GitHub issue or pull request after editing its body and verify
  that headings, lists, checkboxes, code fences, and line breaks remained intact.
