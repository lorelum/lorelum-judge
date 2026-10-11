## Context

#30 validates that a verdict cites evidence its criterion declares. It cannot tell
whether that evidence exists in a run or was rendered into the prompt. #7a adds the
record that answers this. #7b will produce it from a prompt compiler.

## Goals / Non-Goals

**Goals:** a validated record of what evidence existed and what the judge saw; a
citation check against it; a stable identity for it.

**Non-Goals:** prompt construction, truncation algorithms, tokenizers, untrusted
content handling, calibration statistics, and any change to #6 schemas.

## Decisions

### Two axes: what existed, and what was rendered

`status` says what the world provided: `present`, `no_evidence`, `unavailable`, or
`contradiction`. `render.state` says what the prompt did with it: `rendered`,
`withheld`, or `truncated`. They are separate because "the log was unavailable" and
"the log was cut at 8000 characters" are different failures with different fixes.
`no_evidence` and `unavailable` have nothing to render, so they carry no `render`.

### Truncation is recorded, never silent

A `render` always carries `originalLength` and `renderedLength`. `rendered` requires
them equal, `withheld` requires `renderedLength` 0, and `truncated` requires
`renderedLength` below `originalLength`. Lengths count characters; the compiler in
#7b chooses the budget. The contract does not know about tokens.

### Contradiction names its counterpart

A `contradiction` item lists the ids it conflicts with, and each must exist in the
same bundle and not be itself. A contradiction without a counterpart is not a
contradiction, it is a claim nobody can check.

### Only supported verdicts may be decisive

A verdict of `unknown` or `insufficient` may cite anything or nothing. A decisive
verdict must cite at least one item whose status is `present` and whose render state
is `rendered` or `truncated`. Withheld, unavailable, no-evidence, and contradiction
items do not support a decisive verdict. This is the rule that stops a verdict from
resting on material the judge never saw.

### Bundle identity ignores order

`evidenceBundleIdentity` sorts items by id and each `conflictsWith` list before
hashing with `identityOf`. Content, status, and render changes alter it, so a change
in what was shown invalidates anything keyed on it. It does not claim semantic
equivalence: two bundles that read the same to a person but differ in content hash
differently.

### Errors are values

Validators return `{ ok: true, value }` or `{ ok: false, issues }` and never throw,
including for input whose property access throws, using the existing `guarded`
helper. New issue codes: `evidence_item_invalid`, `duplicate_evidence_item`,
`evidence_not_in_bundle`, `verdict_unsupported`.

## Risks / Trade-offs

- Length-in-characters is a proxy for what a model sees. It is recorded honestly but
  does not equal tokens. Acceptable until a real provider exists.
- `contentIdentity` is supplied by the caller; the library does not hash raw content
  because it never receives it. Consumers must hash faithfully.

## Migration Plan

Additive. #6 schemas and identities are unchanged, so existing identities stay
stable.

Rollback removes the new schemas, generated files, validators, and tests.

## Open Questions

None that block this change.
