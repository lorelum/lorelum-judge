# judge-code-evaluation

## ADDED Requirements

### Requirement: Public code evaluation consumes ordinary requests

Judge MUST expose a package API accepting direct materials or authorized local/Git/GitHub sources and ordinary-language evaluation requests. It MUST support code inspection, repository overview, changes, requirement comparison, opinion verification and reassessment without requiring callers to construct measurement records. It MUST NOT score, propose concrete repairs, modify code, write GitHub state or enter delivery workflows.

#### Scenario: PR and requirement request

- **WHEN** a caller provides a PR URL and a requirement reference
- **THEN** Judge obtains actual versioned materials and necessary permitted context and returns an understandable report with evidence and limitations

#### Scenario: Reassessment

- **WHEN** the caller supplies previous problems and updated code
- **THEN** the result explicitly relates current observations to old problem references without claiming a full reevaluation

### Requirement: Sources are implemented and versioned

Direct material, local files/directories and Git selections, and GitHub file/directory/repository/commit/compare/PR/Issue sources MUST have real read implementations. Sources MUST distinguish discovered, read, evaluated and context material. Comparisons MUST retain actual old/new versions, baseline semantics and locations. Unstaged, staged and explicitly included new files MUST remain distinct. Source limits, unavailable contents and observed changes MUST be reported rather than hidden.

#### Scenario: Staged and unstaged differ

- **WHEN** the same file has distinct index and working contents
- **THEN** selecting staged changes evaluates HEAD against index and does not substitute working contents

#### Scenario: Moving PR or truncated enumeration

- **WHEN** a PR changes during reading or its complete change enumeration cannot be obtained
- **THEN** the report binds the observed snapshot and states the change or incomplete coverage without claiming current complete coverage

#### Scenario: Linked PR requirement changes

- **WHEN** an Issue whose material was consumed as a PR requirement changes while PR base/head remain unchanged
- **THEN** freshness verification detects the linked requirement change and does not claim that all consumed sources remain current

#### Scenario: New file regression attribution

- **WHEN** a problem cites a newly added file without old-side code
- **THEN** introduction attribution requires reader-established absence in the matching comparison and MUST NOT fabricate old evidence or infer absence from omitted content

#### Scenario: Terminal newline in explicit references

- **WHEN** an explicit requirement or opinion ends in LF, CRLF or CR
- **THEN** its raw text is retained and its source range follows the canonical terminal-newline convention without invalidating the evaluation


### Requirement: Context acquisition is bounded and read only

Context acquisition MUST enforce caller-authorized roots/repositories, disclosure permissions and resource limits. Model requests MUST NOT grant permissions. Code, comments and linked material MUST remain untrusted data. Preparation calls MUST be distinct from formal evaluation attempts. Acquisition MUST NOT execute candidate code, filters, hooks or arbitrary model commands, mutate a working tree or silently fetch missing Git objects.

#### Scenario: Malicious context request

- **WHEN** source text or model output requests a secret or an out-of-scope file
- **THEN** the reader refuses that access and preserves the resulting limitation

#### Scenario: Initially empty external context

- **WHEN** a selected external comparison initially yields no changed material but could provide context later
- **THEN** its inventory and later contents MUST NOT be disclosed to the model without explicit caller permission


#### Scenario: Cancellation during preparation

- **WHEN** cancellation occurs before formal evaluation
- **THEN** subsequent reads and evaluation do not start and no complete measurement is fabricated

#### Scenario: Cancellation during final verification

- **WHEN** cancellation occurs while checking source freshness after a completed evaluation
- **THEN** the overall request is cancelled while preserving the completed evaluation facts


#### Scenario: Explicit projection budget

- **WHEN** the caller sets an evidence projection budget
- **THEN** both preparation and final evaluation respect that budget, and a partially displayed line cannot support a concrete problem location

#### Scenario: Repeated bounded verification

- **WHEN** unchanged local or working-tree contents are verified more than once
- **THEN** each pass receives its bounded verification budget and unavailable verification MUST NOT be reported as observed content changes

#### Scenario: Unavailable GitHub freshness verification

- **WHEN** a freshness request fails with a network error, HTTP error or exhausted request budget
- **THEN** verification is recorded as unavailable rather than as observed content change; an actual identity mismatch still marks the source inconsistent



### Requirement: Standards and evidence constrain conclusions

Judge MUST preserve explicit user requirements and their sources, distinguish focus from exclusive scope and publish the applied default standards. Preferences without concrete requirements or effects MUST NOT become defects. Missing context, unavailable material, truncation, contradiction, inapplicability and inability to decide MUST remain distinguishable. A conditional concern MUST NOT become a confirmed defect without supporting premises.

#### Scenario: Missing caller contract

- **WHEN** a finding depends on an unavailable caller precondition
- **THEN** the report identifies that condition and missing context rather than asserting an unconditional defect

### Requirement: Structured review results integrate with execution

A versioned result envelope MUST retain original Verdict/v1 values alongside summary, multiple problems, pending observations and follow-up results. Its execution record MUST bind plan, sources, prompt/parser identity and validated results. Existing measurement, evidence, calibration and gate meanings MUST remain unchanged. Invalid problems or citations MUST make execution incomplete, never be silently discarded to obtain success. Partial attempts MUST NOT produce complete runs and late results MUST NOT replace cancellation.

#### Scenario: Invalid problem location with legal verdicts

- **WHEN** verdicts are valid but a problem cites the wrong version, side or unseen line
- **THEN** the invalid item is diagnosed, legal partial observations remain visible and no completed execution or clean report is produced

#### Scenario: Arbitrary legal verdict order

- **WHEN** a complete or partial result returns legal verdicts in a different criterion order
- **THEN** result/measurement consistency is compared by criterion ID while still requiring matching values, rationale and evidence references

#### Scenario: Existing review consumer

- **WHEN** an existing caller uses the default v1 review path
- **THEN** its result schema, identity rules and gate behavior remain unchanged

### Requirement: Reports are readable and traceable

Reports MUST provide a concise overall description, concrete problems with impact/conditions/evidence/locations, relevant pending questions and actual scope/limitations. A deterministic Chinese presentation MUST agree with the structured result, retain important problems and disclose incompleteness. No numerical rating, fictional path, execution claim or automatic delivery permission is allowed. Opinion verification MUST explicitly record whether the opinion is supported; an empty problem list MUST NOT substitute for that judgment.

#### Scenario: No issues after failed evaluation

- **WHEN** evaluation fails, is cancelled or cannot cover its core objective
- **THEN** the presentation states that fact and does not claim that no problems were found

#### Scenario: Incomplete final projection or unresolved follow-up

- **WHEN** final evidence is truncated or withheld, or a requested follow-up is unresolved despite decisive ordinary verdicts
- **THEN** the report remains partial, distinguishes acquired from projected scope, and does not erase a legitimately completed underlying evaluation

#### Scenario: Negative verdict without problem details

- **WHEN** a legal negative verdict has no corresponding problem or summary entry
- **THEN** the Chinese report preserves the judgment, provided rationale and references and does not infer a clean result from the empty detail lists


#### Scenario: Public consumer completes the chain

- **WHEN** a Node ESM consumer imports the built public API and supplies authorized source and model capabilities
- **THEN** it obtains materials, evaluates and renders the report without source imports, prebuilt reports or writes to the target
