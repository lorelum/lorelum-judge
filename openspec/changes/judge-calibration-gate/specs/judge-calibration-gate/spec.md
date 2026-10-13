# judge-calibration-gate Specification

## Purpose

Define evidence-backed calibration and gate decisions that callers can explain to users without conflating a quality failure with missing evidence or an unreliable judge.

## ADDED Requirements

### Requirement: Gate policy declares category coverage and error limits

A calibration policy MUST declare accepted decisive verdicts for each in-scope criterion, required calibration case categories and minimum independent holdout task groups per category, the confidence level, and maximum false-accept, false-reject, abstention, and disagreement rates. It MUST declare the repetition aggregation and fallback mode. A behaviorally equivalent contract case MUST use the expected contract verdict; comparison `equivalent` MUST NOT be required for contract or quality criteria. Case category and expected verdict are separate labels. Unsupported category/verdict combinations MUST be rejected rather than inferred.

#### Scenario: Policy omits a required category

- **WHEN** a policy declares a criterion scope without its required case categories or minimum counts
- **THEN** policy validation fails and the scope cannot qualify

#### Scenario: Criterion kind does not support a case verdict

- **WHEN** calibration labels pair a case category with a verdict not allowed by that criterion
- **THEN** calibration input validation fails without coercing the verdict

### Requirement: Error-rate denominators are explicit

For each criterion and declared task-class/evidence-shape scope, false-accept MUST be unacceptable gold task groups accepted by the gate divided by all unacceptable gold task groups; false-reject MUST be acceptable gold task groups rejected divided by all acceptable gold task groups. Abstention and repetition-disagreement denominators MUST be all task groups in scope. Reports MUST include numerators, denominators, estimates, and Wilson score intervals at the policy confidence level. A group contributes once per criterion after repetition aggregation. Development data MUST NOT contribute to qualification. Caller-provided label truth is not independently certified by the judge.

#### Scenario: Empty error denominator cannot qualify

- **WHEN** a declared scope has no acceptable or no unacceptable holdout groups
- **THEN** the corresponding rate is unavailable and the scope cannot qualify

#### Scenario: Development data does not change qualification metrics

- **WHEN** only development task groups are added to an otherwise unchanged dataset
- **THEN** holdout rates, confidence intervals, and qualification remain unchanged

### Requirement: Calibration inputs are labeled, complete, and identity-bound

A calibration dataset MUST identify its measurement definition, instrument, and declared task-class/evidence-shape scopes. Every task group MUST have one split (`development` or `holdout`), explicit label provenance, expected verdicts for the applicable criteria, evidence references, and one or more validated runs. Every run MUST match the dataset definition and instrument identities. A task group MUST NOT occur in both splits. Invalid or incomplete inputs MUST produce structured issues and MUST NOT produce a qualifying artifact.

#### Scenario: Mismatched run is rejected

- **WHEN** a calibration run's definition or instrument identity differs from the dataset
- **THEN** calibration returns an identity issue and no qualification

#### Scenario: Split leakage is rejected

- **WHEN** a task group appears in both development and holdout data
- **THEN** dataset validation fails and no holdout qualification is produced

#### Scenario: Missing provenance or labels is rejected

- **WHEN** an expected verdict has no declared provenance or omits an applicable criterion
- **THEN** validation reports the missing field and does not infer a failure or score

### Requirement: Calibration reports task-level error, uncertainty, and stability

Calibration MUST report false-accept, false-reject, abstention, and repetition-disagreement rates per criterion and declared task-class/evidence-shape scope, including task-group counts and uncertainty intervals. Development data MUST NOT contribute to qualification. Repeated runs for one task group MUST be aggregated according to the frozen policy and MUST count as one independent task group. `unknown` and `insufficient` predictions MUST count as abstentions, not quality failures.

#### Scenario: Repetitions do not inflate sample count

- **WHEN** one task group has multiple repeated runs
- **THEN** it contributes at most one expected/predicted outcome to each criterion's error-rate sample count, and disagreement is reported separately

#### Scenario: Under-covered scope is indeterminate

- **WHEN** holdout data lacks a required verdict category or the minimum independent task-group count for a declared scope
- **THEN** that scope is reported as indeterminate and cannot qualify

#### Scenario: Uncertainty bound misses policy threshold

- **WHEN** a metric's policy-required confidence bound exceeds its predeclared maximum
- **THEN** that scope cannot qualify even if its point estimate is within the maximum

### Requirement: Qualification is derived, current, and scoped

A calibration artifact MUST bind canonical identities for the measurement definition, instrument, dataset, calibration policy, report, and declared applicability scope, and MUST declare its status and validity interval. Qualification MUST be recomputed or verified against the supplied dataset and validated runs; a claimed `enforced` status alone MUST NOT grant enforcement. Any identity or scope mismatch, insufficient coverage, unmet threshold, expired validity, or revocation MUST prevent enforcement. Existing v1 records MUST NOT be treated as v2 qualification.

#### Scenario: Changed instrument invalidates qualification

- **WHEN** model, prompt, runtime, decoding, repetition configuration, measurement definition, or calibration policy changes
- **THEN** the old artifact does not qualify for the changed identity

#### Scenario: Forged status cannot bypass eligibility

- **WHEN** an artifact claims `enforced` but its report or source data fails qualification checks
- **THEN** the evaluator denies enforcement and returns the applicable reason

#### Scenario: Expired or revoked artifact degrades

- **WHEN** the artifact is expired or revoked
- **THEN** the evaluator returns a non-enforcing decision with a reason and the configured fallback mode

### Requirement: Gate results separate quality from execution mode

Gate evaluation MUST return a quality outcome of `pass`, `fail`, or `indeterminate`, an execution mode, criterion-level findings, reason codes, evidence IDs, and next-action codes. A decisive unmet mandatory criterion with supporting evidence MAY produce `fail`. Missing, unavailable, truncated, contradictory, or unsupported evidence; an unknown/insufficient verdict; or unreliable repeated results MUST NOT by themselves produce a quality failure. Ineligible calibration MUST NOT block unrelated work and MUST follow the configured `diagnostic`, `shadow`, or `indeterminate` fallback.

#### Scenario: Supported unmet criterion fails

- **WHEN** a mandatory criterion has a validated decisive unmet verdict supported by evidence
- **THEN** the result is `fail` and identifies that criterion and its evidence

#### Scenario: Missing evidence is not a quality failure

- **WHEN** a mandatory criterion cannot be assessed because its evidence is absent or unsupported
- **THEN** the result is `indeterminate`, identifies the missing evidence, and suggests the next evidence action

#### Scenario: Valid calibration allows enforcement

- **WHEN** calibration qualifies for the current identity and scope, is current, and all applicable gate requirements are satisfied
- **THEN** the result may use `enforced` mode while retaining the quality outcome and its findings

### Requirement: Failure attribution is not guessed

Calibration and gate reports MUST distinguish quality errors, abstentions, identity/input validation failures, and repetition disagreement. A rubric, fixture/label, evidence, prompt, provider, threshold, or measurement-noise cause MUST be assigned only when supported by recorded diagnostics; otherwise the report MUST preserve an unattributed reason.

#### Scenario: Unsupported root cause remains unattributed

- **WHEN** a measurement is wrong but supplied diagnostics do not establish why
- **THEN** the report records the error without inventing a provider, rubric, or fixture cause
