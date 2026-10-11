# protocol-evidence-bundle Specification

## Purpose
Record what evidence existed for a measurement, what the judge was shown of it, and
whether a verdict's citations are supported, without forging missing evidence into
failure.

## Requirements

### Requirement: Evidence items declare status and render state

An `EvidenceItem` MUST have an `id` and a `status` of `present`, `no_evidence`,
`unavailable`, or `contradiction`. An item with status `present` or `contradiction`
MUST carry a `contentIdentity` of the form `sha256:` plus 64 lowercase hex
characters and a `render` with state `rendered`, `withheld`, or `truncated`, and
`originalLength` and `renderedLength`. An item with status `no_evidence` or
`unavailable` MUST NOT carry `contentIdentity`, `render`, or `conflictsWith`.

#### Scenario: Present item without a render state is rejected

- **WHEN** an item with status `present` has no `render`
- **THEN** validation fails with code `evidence_item_invalid`

#### Scenario: Unavailable item carrying content is rejected

- **WHEN** an item with status `unavailable` has a `contentIdentity`
- **THEN** validation fails with code `evidence_item_invalid`

### Requirement: Render lengths match the render state

`rendered` MUST have equal `originalLength` and `renderedLength`. `withheld` MUST
have `renderedLength` 0. `truncated` MUST have `renderedLength` above 0 and below
`originalLength`; a truncation that kept nothing is `withheld`. Truncation MUST NOT
be implied; it is present only as a recorded `truncated` state.

#### Scenario: Truncated item that kept nothing is rejected

- **WHEN** a `truncated` render has a `renderedLength` of 0
- **THEN** validation fails with code `evidence_item_invalid`

#### Scenario: Truncated item that kept everything is rejected

- **WHEN** a `truncated` render has equal original and rendered lengths
- **THEN** validation fails with code `evidence_item_invalid`

#### Scenario: Withheld item that kept text is rejected

- **WHEN** a `withheld` render has a non-zero `renderedLength`
- **THEN** validation fails with code `evidence_item_invalid`

### Requirement: Contradictions name their counterparts

An item with status `contradiction` MUST list at least one id in `conflictsWith`.
Every listed id MUST belong to another item in the same bundle. An item with any
other status MUST NOT carry `conflictsWith`.

#### Scenario: Contradiction without a counterpart is rejected

- **WHEN** a `contradiction` item has an empty or missing `conflictsWith`
- **THEN** validation fails with code `evidence_item_invalid`

#### Scenario: Contradiction naming an unknown id is rejected

- **WHEN** a `contradiction` item lists an id absent from the bundle
- **THEN** validation fails with code `evidence_not_in_bundle`

### Requirement: Bundle item ids are unique

A bundle MUST NOT contain two items with the same `id`. An empty bundle is valid and
means no evidence was collected.

#### Scenario: Duplicate item id is rejected

- **WHEN** two items share an id
- **THEN** validation fails with code `duplicate_evidence_item`

#### Scenario: Empty bundle is accepted

- **WHEN** a bundle has no items
- **THEN** validation succeeds

### Requirement: Verdict citations are checked against the bundle

`validateVerdictEvidence` MUST first validate the verdict against its criterion and
the bundle on their own, then require every id in the verdict's `evidenceIds` to
belong to the bundle. A verdict of `unknown` or `insufficient` MAY cite no evidence.
A decisive verdict MUST cite at least one item with status `present`, render state
`rendered` or `truncated`, and a `renderedLength` above 0. An empty item exists but
shows the judge nothing, so it cannot support a decisive verdict.

#### Scenario: Citing an id outside the bundle is rejected

- **WHEN** a verdict cites an evidence id the bundle does not contain
- **THEN** validation fails with code `evidence_not_in_bundle`

#### Scenario: Decisive verdict resting on unseen evidence is rejected

- **WHEN** a decisive verdict cites only withheld, unavailable, no-evidence, or
  contradiction items
- **THEN** validation fails with code `verdict_unsupported`

#### Scenario: Unknown verdict citing nothing is accepted

- **WHEN** a verdict of `unknown` cites no evidence and the bundle has none
- **THEN** validation succeeds

#### Scenario: Decisive verdict resting on an empty present item is rejected

- **WHEN** a decisive verdict cites only a `present` item whose `renderedLength` is 0
- **THEN** validation fails with code `verdict_unsupported`

#### Scenario: Decisive verdict citing a truncated item is accepted

- **WHEN** a decisive verdict cites a `present` item that was `truncated`
- **THEN** validation succeeds

### Requirement: Bundle identity is order independent and change sensitive

`evidenceBundleIdentity` MUST return the same identity for the same items in any
order, and a different identity when any item's content identity, status, render
state, lengths, or conflicts change.

#### Scenario: Reordered items keep the identity

- **WHEN** the same items are supplied in a different order
- **THEN** the identity is equal

#### Scenario: A render change changes the identity

- **WHEN** an item moves from `rendered` to `truncated`
- **THEN** the identity differs

### Requirement: Validation returns values

Every function in this capability MUST return a result value and MUST NOT throw for
invalid input, including input whose property access throws.

#### Scenario: Hostile bundle does not throw

- **WHEN** a bundle has a getter that throws
- **THEN** the function returns a failed result and does not throw

### Requirement: Referenced schemas resolve and generated types stay current

The new schemas MUST be generated into TypeScript types and checked by the
repository gate like the existing ones, and the built entrypoint MUST load them in
Node ESM.

#### Scenario: Dist smoke test

- **WHEN** the built entrypoint is imported in Node ESM and given a valid bundle
- **THEN** validation succeeds
