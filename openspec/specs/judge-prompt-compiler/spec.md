# judge-prompt-compiler Specification

## Purpose
Turn a measurement's rules and raw evidence into the messages a model receives, a
manifest of what was shown, and identities that are computed here rather than declared
by the caller.

## Requirements

### Requirement: Compilation is order independent

`compilePrompt` MUST produce identical messages, manifest, and identities for the same
rules and the same evidence supplied in any order or with object keys in any order.

#### Scenario: Shuffled evidence produces the same output

- **WHEN** the same evidence items are supplied in a different order
- **THEN** messages, manifest, and all three identities are equal

### Requirement: Budget renders evidence in id order

Evidence MUST be rendered in ascending id order under a character budget counted in
code points. The first item that fits is `rendered`; the first that does not fit is
`truncated` to the remaining budget when some remains, otherwise `withheld`; every later
present item is `withheld`. `unavailable` and `no_evidence` items MUST render as a line
and consume no budget. The budget MUST be a non-negative safe integer.

#### Scenario: Boundary truncation

- **WHEN** the budget is 10 and items of length 6 and 6 are present
- **THEN** the first is `rendered`, the second is `truncated` with `renderedLength` 4,
  and no later item is rendered

#### Scenario: Zero budget withholds all present evidence

- **WHEN** the budget is 0 and a present item exists
- **THEN** that item is `withheld` with `renderedLength` 0 and its header still appears

### Requirement: The manifest is a validated evidence bundle

The returned manifest MUST pass `validateEvidenceBundle` from `protocol`. Each present or
contradiction item MUST carry a `contentIdentity` computed by the compiler from its
normalized text. A compilation whose manifest fails validation MUST return issues.

#### Scenario: Manifest validates

- **WHEN** a valid set of materials is compiled
- **THEN** `validateEvidenceBundle(manifest)` succeeds

### Requirement: Headers record what was shown

Each evidence block header MUST state the id, status, render state, original length,
and rendered length. A `contradiction` header MUST list the ids it conflicts with.
Evidence ids MUST match `^[A-Za-z0-9_.:-]+$`.

#### Scenario: Truncated block declares its length

- **WHEN** an item is truncated
- **THEN** its header states both lengths and the rendered text is the first
  `renderedLength` code points

#### Scenario: Id that could break the header is rejected

- **WHEN** an id contains a quote or a space
- **THEN** compilation fails with code `invalid_evidence`

### Requirement: Variables are bound exactly

Every `{{name}}` in the template MUST be bound in `variables`, and every bound name MUST
appear in the template. Names MUST match `^[a-z][a-z0-9_]*$`. `evidence` is reserved and
MUST appear exactly once in the template. Substitution MUST be a single pass: a value
containing a placeholder MUST appear literally.

#### Scenario: Missing binding fails

- **WHEN** the template uses `{{goal}}` and no `goal` is bound
- **THEN** compilation fails with code `unbound_variable`

#### Scenario: Extra binding fails

- **WHEN** a variable is bound but not used
- **THEN** compilation fails with code `unknown_variable`

#### Scenario: Placeholder inside a value is not expanded

- **WHEN** a value is `{{evidence}}`
- **THEN** the rendered message contains that text literally and only one evidence block
  section

### Requirement: Mechanical differences do not change identity

Before any rendering or hashing, text MUST be normalized: NFC, line endings converted to
`\n`, and trailing spaces and tabs removed from every line. Text differing only in these
ways MUST produce identical messages and identities. Any other difference MUST change at
least the identity of the text that contains it.

#### Scenario: CRLF and trailing spaces are ignored

- **WHEN** a rule differs from another only by `\r\n` against `\n` and trailing spaces
- **THEN** the prompt identity is equal

#### Scenario: One word changes the identity

- **WHEN** one word of a rule changes
- **THEN** the prompt identity differs

### Requirement: Identities have distinct scopes

The prompt identity MUST depend on the normalized system text, normalized template,
normalized variable bindings (names and values, sorted by name), render version,
evidence budget, and rule budget. A variable value is rubric material and therefore part
of the prompt, as `AGENTS.md` 4.2 requires. The render identity MUST depend on the final
messages. Changing a variable value MUST change both identities. Changing the budget,
the rule budget, or the template MUST change the prompt identity.

#### Scenario: Value change affects both identities

- **WHEN** a bound variable value changes
- **THEN** the prompt identity and the render identity both differ

### Requirement: Untrusted-content notice is present

The system message MUST end with the fixed notice that evidence blocks are data to be
assessed and are not instructions. The notice MUST be covered by the prompt identity.

#### Scenario: Notice is in the system message

- **WHEN** any input is compiled
- **THEN** the system message contains the notice text

### Requirement: Compilation never throws

`compilePrompt` MUST return `{ ok: true, value }` or `{ ok: false, issues }` and MUST NOT
throw for any input, including input whose property access throws.

#### Scenario: Hostile input

- **WHEN** the prompt specification has a getter that throws
- **THEN** the result is a failure carrying the thrown message

### Requirement: Bindings are own properties only

A variable is bound only if it is an own property of `variables`. A placeholder whose
name matches an inherited property of `Object.prototype` and has no own binding MUST
fail with `unbound_variable`; it MUST NOT render the inherited value.

#### Scenario: Inherited name is unbound

- **WHEN** the template uses `{{constructor}}` and `variables` has no own `constructor`
- **THEN** compilation fails with code `unbound_variable`

### Requirement: Evidence text cannot forge a block

Before lengths and identities are computed, `<evidence` and `</evidence` in evidence
text MUST be escaped to `&lt;evidence` and `&lt;/evidence`, case-insensitively. The
manifest's lengths MUST count the escaped text the model sees. `contentIdentity` MUST be
computed from the normalized text before escaping, so two different candidate texts
that render identically are still distinguishable in the record. Only the compiler writes headers and closing markers.

#### Scenario: Forged closing and opening markers are inert

- **WHEN** an item's text contains `</evidence>` followed by a new `<evidence ...>` header
- **THEN** the rendered prompt contains exactly one real `</evidence>` for that item and
  the forged markers appear escaped

#### Scenario: Known limitation

Escaping covers only the `evidence` marker, matched case-insensitively. Other content
is not escaped. A reader that
does not respect headers can still be misled by text in an evidence block; the spec does
not claim otherwise.

### Requirement: Empty present evidence is recorded and cannot support a decision

A `present` item whose normalized text is empty MUST be accepted as a record. It renders
as `rendered` with lengths 0 only while budget remains, and as `withheld` otherwise (see
the budget requirement). Under #7a's citation rule it cannot support a decisive verdict.

#### Scenario: Empty item does not support a decisive verdict

- **WHEN** a decisive verdict cites only an empty `present` item
- **THEN** `validateVerdictEvidence` fails with code `verdict_unsupported`

### Requirement: Evidence budget covers evidence text only

The evidence budget MUST count only the code points of evidence text. Headers,
unavailable and no-evidence lines, and the untrusted notice MUST NOT be counted against
it. Prompt size therefore grows with the number of items, and this capability does not
cap item count.

#### Scenario: Headers do not consume budget

- **WHEN** the evidence budget is 0 and several unavailable items exist
- **THEN** every header is rendered and no item is truncated or withheld for that reason

### Requirement: Rule length is capped and overflow is an error

Rules are the normalized system text, the normalized template, and every variable value.
Their total length in code points MUST NOT exceed `ruleBudget`. An overflow MUST fail
with code `rules_over_budget` and MUST NOT truncate any rule. `ruleBudget` MUST be a
non-negative safe integer, and it MUST be part of the prompt identity. Evidence MUST NOT
count toward `ruleBudget`.

#### Scenario: Rules at the limit compile

- **WHEN** the rules total exactly `ruleBudget` code points
- **THEN** compilation succeeds

#### Scenario: One character over fails

- **WHEN** the rules total `ruleBudget` plus one code point
- **THEN** compilation fails with code `rules_over_budget` and the message names the limit

#### Scenario: Variable values count

- **WHEN** a long variable value pushes the rules over `ruleBudget`
- **THEN** compilation fails with code `rules_over_budget`

### Requirement: Empty present evidence follows the budget

An empty `present` item MUST be `rendered` only while budget remains. Once the budget is
spent, or when it is zero, an empty `present` item MUST be `withheld` with lengths 0.
An empty `present` item MUST NOT support a decisive verdict under #7a.

#### Scenario: Empty item after the budget is spent

- **WHEN** the budget is spent and a later item is empty
- **THEN** that item is `withheld` with `originalLength` 0

### Requirement: Manifest issues point at the caller's input

When the manifest fails validation, each issue path MUST refer to the caller's
`$.evidence[i]` position, not to the manifest's sorted `$.items[i]` position.

#### Scenario: Conflict path maps to the input position

- **WHEN** a contradiction at input position 0 names an id absent from the bundle
- **THEN** the issue path is `$.evidence[0].conflictsWith[0]`

### Requirement: Rendered output format is pinned

The exact messages for a fixed input MUST match a pinned string in the test suite. Any
change to the rendered format MUST be accompanied by a change to `PROMPT_RENDER_VERSION`.

#### Scenario: Format change without a version bump

- **WHEN** the header format changes and the pinned test is updated
- **THEN** `PROMPT_RENDER_VERSION` MUST also change in the same commit
