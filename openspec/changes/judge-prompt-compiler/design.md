## Context

#7a defines `EvidenceBundle` with statuses and render states but takes content
identities from the caller. This change adds the compiler that renders content,
computes the identities itself, and emits a manifest that #7a's validator accepts.

## Goals / Non-Goals

**Goals:** one code path from raw evidence to messages, manifest, and identities;
deterministic output; explicit record of what was shown.

**Non-Goals:** semantic equivalence, token counting, evidence priority, calibration,
and any change to `protocol`.

## Decisions

### Budget fills in id order, and the budget counts evidence only

Materials sort by id, then consume a character budget in that order. The first item
that fits is `rendered`; the first that does not fit is `truncated` to the remaining
characters if any remain, and every later one is `withheld`. Rules are governed separately by `ruleBudget` and never count against the evidence budget.
An empty item is rendered only while budget remains; once the budget is spent it is
withheld like any other present item.

### Rule overflow is an error, not truncation

Rules are the normalized system text, template, and variable values. Their total is
capped by `ruleBudget`, and an overflow fails with `rules_over_budget`. Truncating a
rule would silently change what the model was asked to do, so the compiler refuses
instead. The caller must shorten the rules. `ruleBudget` is part of the prompt identity
because changing the cap changes which rule sets are accepted.

### Lengths are Unicode code points

`originalLength` and `renderedLength` count code points (`Array.from(text).length`), so
truncation never splits a surrogate pair. This is a stated unit, not tokens. The protocol README (#7a) now says code points too; no #7a schema changes are needed.

### Mechanical normalization happens before any hashing

Text is normalized once: NFC, line endings to `\n`, trailing spaces and tabs removed
from each line. Normalized text is what is rendered, measured, and hashed. Therefore
CRLF versus LF, trailing whitespace, and NFC versus NFD produce identical output and
identities. Any other change, including one word, produces a different identity. This
is deliberate: the compiler cannot know whether a word change alters a score, so it
treats every such change as significant.

### Three identities, with distinct scopes

- **Prompt identity** (`lorelum.judge.prompt/v1`): normalized system text, normalized
  template, sorted variable names, render version, and evidence budget. Written into
  `InstrumentProfile.promptIdentity`. Changing any of these invalidates calibration.
  Variable values are included, because rubric text is part of the prompt (`AGENTS.md`
  4.2). `ruleBudget` is included because it decides which rule sets are accepted.
- **Content identity** per evidence item (`lorelum.judge.evidence-content/v1`): hash of
  the normalized text before escaping. Stored in the manifest's `contentIdentity`. Because the
  compiler computes it, #7a's caller-supplied limitation does not apply to this path.
- **Render identity** (`lorelum.judge.render/v1`): hash of the final messages. This is
  the record of exactly what the model received.

The evidence bundle identity from #7a is available by passing the manifest to
`evidenceBundleIdentity`.

### Variables: minimal, strict, single pass

`{{name}}` placeholders in the template are replaced in one pass over the template.
Substituted values are never rescanned, so a value containing `{{evidence}}` stays
literal. Every placeholder name must be bound, every bound name must appear, names
match `^[a-z][a-z0-9_]*$`, and `evidence` is reserved for the evidence block, which
must appear exactly once. Unclosed or malformed braces are literal text.

### Evidence rendering is framed by metadata, not escaping

Each block's header carries the id, status, render state, and exact lengths. Ids are
restricted to `^[A-Za-z0-9_.:-]+$`, so they cannot break the attribute syntax. Content
is escaped only for the `evidence` marker; the header's declared length says how much text the block should hold,
which lets a reader detect an injected closing tag. The model is not guaranteed to
honor this.

### Untrusted-content notice is fixed text

The system message ends with a fixed sentence stating that evidence blocks are data to
be assessed and not instructions. This establishes a stable, identity-covered marker.
It does not prevent the model from following instructions in evidence, and the spec
does not claim that it does.

### Escaping of candidate text

Evidence text is candidate output and is untrusted. `<evidence` and `</evidence` are
escaped to `&lt;evidence` and `&lt;/evidence` before lengths and hashing. Only these
markers are escaped, to keep the text readable. The header's declared length is
accurate, but it does not prove that a reader interprets the block boundaries the way
the compiler intends; that is stated as a limitation in the spec.

### Bindings are own properties

Bindings are a `Map` built from own entries, and lookups use `Map.has` and `Map.get`.
Object prototype names such as `constructor` therefore cannot resolve to inherited
values.

### Content identity covers the raw candidate, lengths cover the escaped text

Two candidate texts that differ only in `</evidence>` against `&lt;/evidence>` render
identically, so the model sees the same prompt and the render identity is equal. The
content identity differs, because the record should show what each candidate said. The
manifest lengths count what was shown.

## Risks / Trade-offs

- A truncated item keeps a prefix, which may hide the decisive part of the evidence.
  The record shows this; the budget choice is the caller's.
- Trailing-whitespace removal would alter code whose whitespace matters, for example a
  Makefile or Markdown with hard line breaks. This is accepted for the judge's purpose
  and documented.
- Headers and unavailable lines are outside the budget, so item count is uncapped.
- A rendering change must bump `PROMPT_RENDER_VERSION`; the pinned-output test forces the
  question but does not bump it automatically.
- Id ordering means the same material can be truncated differently after an id rename.
  The prompt identity changes only with the budget, not with ids, so this is captured
  by the manifest, not the prompt identity.

## Migration Plan

New module in `judge`, no existing callers. Rollback removes the module, its tests, and
the README section.

## Open Questions

None that block this change.
