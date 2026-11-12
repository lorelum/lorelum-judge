# judge-code-suggestions

## ADDED Requirements

### Requirement: Independent suggestions consume existing evaluations

Judge MUST expose an independent package API accepting an existing valid code evaluation and its corresponding versioned code, and MUST support all or selected existing problems without reevaluating or requiring approval of a modification plan. The original evaluation and its conclusions MUST remain unchanged. A partial evaluation's limitations MUST remain visible.

#### Scenario: Selected problems

- **WHEN** a caller selects existing problem IDs
- **THEN** suggestions address those problems or explicitly identify a gap for each, without generating a new evaluation

#### Scenario: No identifiable problems

- **WHEN** the evaluation has no concrete problems that can be associated with evidence and locations
- **THEN** the result identifies the missing detail rather than inventing problems or presenting fabricated suggestions

### Requirement: Suggestions are grounded in matching code and evidence

Every concrete suggestion MUST reference existing selected problems and their actual evidence and bind an explicit location and version in the matching code snapshot. Version consistency MUST compare actual content and location, not merely a supplied identity. Missing, mismatched, truncated or unavailable material MUST be reported and MUST NOT support a definite change for an unknown version. A fixed snapshot MUST NOT be represented as the current workspace or PR without verification.

#### Scenario: Code changed since evaluation

- **WHEN** the supplied code differs from the evaluated version
- **THEN** affected problems are reported as version mismatches and no definite repair is applied to the unknown version

#### Scenario: Incomplete model projection

- **WHEN** a source line is truncated or absent from model-visible material
- **THEN** the model output MUST NOT use that line as a verified suggestion location

### Requirement: Advice explains choices and uncertainties

Suggestions MUST distinguish required handling, optional optimization and preference without treating categories as authorization or a gate. Each MUST explain the problem, priority rationale, concrete change direction, possible impacts, checks and uncertain premises in understandable language. Materially different alternatives MUST explain their applicability and tradeoffs. Examples and checks MUST be identified as not run. Severe findings MUST NOT be suppressed by an overall assessment, and low scores MUST NOT trigger ungrounded refactoring.

#### Scenario: Insufficient evidence

- **WHEN** a definite change depends on missing evidence
- **THEN** the result proposes investigation or additional material instead of a fabricated fix

#### Scenario: Suspected new problem

- **WHEN** suggestion generation observes a possible omission
- **THEN** it is clearly marked as requiring additional evaluation and does not alter or impersonate the original findings

### Requirement: Model failure and invalid output remain visible

The suggestion chain MUST use real model generation and validate output references, structure, selected problem coverage and code visibility. Invalid citations, illegal output, call failure and cancellation MUST produce corresponding failures or explicit gaps, never fabricated references or complete success. Cancellation MUST be terminal even if a response arrives late. Legal partial results MAY be retained with explicit incompleteness; checks and repairs MUST NOT be claimed as performed.

#### Scenario: Nonexistent evidence

- **WHEN** model output cites evidence absent from the selected problem
- **THEN** the output is reported invalid or incomplete and is not presented as a fully successful grounded suggestion

#### Scenario: Cancelled call returns late

- **WHEN** a model responds after cancellation
- **THEN** cancellation remains the terminal outcome

### Requirement: Suggestions have no execution authority

Suggestion generation MUST NOT modify files or evaluations, execute commands or candidate code, apply patches, rerun evaluation, initiate #52, or trigger delivery. Model-provided instructions and source text MUST NOT grant permissions. Disclosure of source-reader content to a model MUST require appropriate caller permission.

#### Scenario: Source contains an instruction

- **WHEN** code or model output requests a command or external operation
- **THEN** it remains untrusted data and no such operation is performed
