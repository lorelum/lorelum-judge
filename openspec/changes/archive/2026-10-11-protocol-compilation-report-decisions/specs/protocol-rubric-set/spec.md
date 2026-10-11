## MODIFIED Requirements

### Requirement: A compilation report agrees with the rubric

A `CompilationReport` MUST have a `contractIdentity` and the lists `covered`, `uncovered`, `unsupported`, `merged`, and `excluded`. `validateCompilationReport` MUST require that: every acceptance id of the contract appears in exactly one of `covered`, `uncovered`, and `unsupported`; an id with covering entries is in `covered` and lists exactly those criterion ids; an id with none is in `uncovered` or `unsupported` with a non-blank `reason`; each `merged` record names a `criterionId` present in the rubric and `mergedFrom` ids absent from it; a criterion id has at most one `merged` record; an absorbed id is not merged into two criteria; and each `excluded` item satisfies the rules in the Excluded requirement below. A `reason` is blank when it has no character other than white space, control characters, format characters, nonspacing and enclosing combining marks, and the fixed glyphs U+115F, U+1160, U+3164, U+FFA0, and U+2800. The list of glyphs is fixed; it is not a complete table of invisible characters, and a reason made only of combining marks is blank. Spacing combining marks (category Mc) are visible and are not blank. A report whose `contractIdentity` differs from the contract's MUST fail with `identity_mismatch`.

`merged` and `excluded` records are supplied by the caller and are NOT verified against the proposals they describe: the validator receives only the rubric and the contract. It checks that the records are coherent with the rubric and with each other, and no more.

#### Scenario: Report claims coverage nothing provides

- **WHEN** an acceptance id is `covered` but no entry covers it
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Report omits an acceptance id

- **WHEN** an acceptance id is in none of the three lists
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Report lists an id twice

- **WHEN** an acceptance id is in two of the three lists
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Covered with the wrong criterion ids

- **WHEN** `covered` lists criterion ids that differ from the entries covering it
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Merged record naming a surviving id

- **WHEN** a `mergedFrom` id is still present in the rubric
- **THEN** validation fails with code `report_mismatch`

## ADDED Requirements

### Requirement: Excluded proposals are recorded

Each `excluded` item MUST have a `criterionId`, a `code` of `not_applicable` or `conflict`, and a non-blank `reason`. The `criterionId` values in `excluded` MUST be unique. Ids are compared exactly, with no trimming or case folding, as elsewhere in the rubric: `c1 ` is a different id from `c1`. A report without an `excluded` field MUST fail schema validation.

#### Scenario: A criterion in the rubric cannot also be excluded

- **WHEN** an `excluded` item names a criterion that is in the rubric
- **THEN** validation fails with code `report_mismatch`

#### Scenario: An absorbed proposal cannot also be excluded

- **WHEN** an `excluded` item names an id that appears in a `merged` record's `mergedFrom`
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Repeated excluded id

- **WHEN** two `excluded` items name the same `criterionId`
- **THEN** validation fails with code `report_mismatch`

#### Scenario: Blank reason

- **WHEN** an `excluded` item has a `reason` of only whitespace
- **THEN** validation fails with code `schema`
