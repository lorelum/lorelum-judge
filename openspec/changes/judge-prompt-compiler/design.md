## Context

#7a defines `EvidenceBundle` with statuses and render states but takes content
identities from the caller. This change adds the compiler that renders content,
computes the identities itself, and emits a manifest that #7a's validator accepts.

## Goals / Non-Goals

**Goals:** one code path from raw evidence to messages, manifest, and identities;
deterministic output; explicit record of what was shown.

**Non-Goals:** semantic equivalence, token counting, evidence priority, calibration,
rule-length budgets, and any change to `protocol`.

## Decisions

### Budget fills in id order, and the budget counts evidence only

Materials sort by id, then consume a character budget in that order. The first item
that fits is `rendered`; the first that does not fit is `truncated` to the remaining
characters if any remain, and every later one is `withheld`. Rules (system text and
template) are never truncated and are not counted against the budget, so a long rule
cannot cause evidence to vanish silently. Id order is arbitrary; it is chosen because it
is deterministic and independent of caller order. A caller who needs priority will
need a field, which this change does not add.

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
  Variable values are excluded; they are covered by the render identity.
- **Content identity** per evidence item (`lorelum.judge.evidence-content/v1`): hash of
  the normalized full text. Stored in the manifest's `contentIdentity`. Because the
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
is not escaped; the header's declared length says how much text the block should hold,
which lets a reader detect an injected closing tag. The model is not guaranteed to
honor this.

### Untrusted-content notice is fixed text

The system message ends with a fixed sentence stating that evidence blocks are data to
be assessed and not instructions. This establishes a stable, identity-covered marker.
It does not prevent the model from following instructions in evidence, and the spec
does not claim that it does.

## Risks / Trade-offs

- A truncated item keeps a prefix, which may hide the decisive part of the evidence.
  The record shows this; the budget choice is the caller's.
- Trailing-whitespace removal would alter code whose whitespace matters, for example a
  Makefile or Markdown with hard line breaks. This is accepted for the judge's purpose
  and documented.
- Id ordering means the same material can be truncated differently after an id rename.
  The prompt identity changes only with the budget, not with ids, so this is captured
  by the manifest, not the prompt identity.

## Migration Plan

New module in `judge`, no existing callers. Rollback removes the module, its tests, and
the README section.

## Open Questions

None that block this change.
