# judge-calibration-gate Specification

## Purpose

Calibrate Judge against known outcomes and return understandable gate decisions without mistaking missing evidence or judge failures for poor quality.

## ADDED Requirements

### Requirement: Calibration cases preserve labels, evidence, repetitions, and task grouping

A calibration dataset MUST bind a measurement definition and instrument. Each task group MUST declare a stable source `taskIdentity`, one split, task class, evidence shape, and one or more labeled cases. A source task identity MUST appear in only one task group, so its variants cannot be split across development and holdout by changing a record ID. Each case MUST declare a criterion, kind-valid expected verdict, category (`decisive`, `equivalent`, `anti`, or `partial`), label provenance, evidence references, and exactly `InstrumentProfile.repetitions` observations with distinct measurement run identities. Each successful observation MUST contain a validated run and evidence bundle matching the bound identities; execution failures MUST be represented distinctly from verdicts and MAY retain an evidence bundle collected before failure. A task group MUST occur in only one split.

#### Scenario: Split leakage is rejected

- **WHEN** the same source task identity appears in more than one group or split, even if record IDs differ
- **THEN** dataset validation fails and no calibration qualifies

#### Scenario: Missing label or evidence reference is rejected

- **WHEN** a case omits its expected verdict, provenance, or a referenced evidence item
- **THEN** validation returns a structured issue and does not infer a score

#### Scenario: Repetition count must match instrument

- **WHEN** a case has fewer or more observations than the bound instrument declares
- **THEN** calibration validation fails rather than padding or silently dropping observations

### Requirement: Gate policy declares verdict acceptance, coverage, and thresholds

`GatePolicy/v2` MUST bind the definition and instrument, applicability scopes, acceptable decisive verdicts per criterion, required case categories and minimum independent holdout task groups, minimum decisive agreement, confidence level, maximum false-accept/false-reject/abstention/disagreement rates, and fallback mode. Mandatory contract criteria MUST accept only `met`. Equivalent contract behavior MUST be labeled with expected verdict `met`; the `equivalent` verdict MUST NOT be required for contract or quality criteria. The default policy MUST use three repetitions, `2/3` agreement, 20 groups per required case category, 95% Wilson intervals, and limits of 5%, 10%, 20%, and 20% respectively.

#### Scenario: Invalid criterion verdict is rejected

- **WHEN** a policy accepts a verdict not supported by the criterion kind or accepts `unmet` for a mandatory contract criterion
- **THEN** policy validation fails

#### Scenario: Changed policy invalidates qualification

- **WHEN** agreement, coverage, confidence, threshold, fallback, or accepted-verdict policy changes
- **THEN** the policy identity changes and the old calibration cannot qualify

### Requirement: Calibration report uses held-out task groups and reports uncertainty

Only holdout cases MUST contribute to qualification. Variants and repetitions in the same task group MUST count as at most one independent group per criterion and scope. The report MUST provide task-group and case counts plus numerator, denominator, point estimate, and a Wilson interval for false accept, false reject, abstention, and disagreement; the default confidence level is 95%. False-accept denominator is groups containing unacceptable gold cases; false-reject denominator is groups containing acceptable gold cases. Abstention and disagreement denominators are all groups in scope. Each group contributes at most one event to a metric, and each supplied failure category MUST be counted at most once per group. A zero denominator MUST have no estimate or interval; a non-zero denominator MUST have a complete count-consistent estimate and interval. No denominator, insufficient category coverage, under-minimum count, or an upper bound above policy MUST make the scope ineligible.

#### Scenario: Repetitions and variants do not inflate sample count

- **WHEN** a task group has multiple behavior variants or repeated observations
- **THEN** rates count the task group once per criterion and report cases and observations separately

#### Scenario: Development data cannot change qualification

- **WHEN** development cases are added or changed without changing holdout cases
- **THEN** holdout metrics and qualification remain unchanged

#### Scenario: Point estimate passes but interval does not

- **WHEN** a point estimate is under its limit but the Wilson upper bound exceeds it
- **THEN** that scope remains ineligible

### Requirement: Verified calibration is required for enforcement

`CalibrationArtifact/v2` MUST bind definition, instrument, dataset, policy, report, scope, status, and validity interval. Loading MUST recompute the report from the bound source data and return a process-local verified value. A raw artifact status or report alone MUST NOT enable enforcement. The default new status is `shadow`; only an eligible, current, identity- and scope-matched verified value with explicit enforced status may be used for automatic blocking. Expired, revoked, provisional, or mismatched calibration MUST use the configured fallback. Existing v1 records MUST remain compatible but MUST NOT qualify for v2 enforcement.

#### Scenario: Forged enforcement status is rejected

- **WHEN** an artifact claims `enforced` but recomputation, identity, scope, or validity fails
- **THEN** loading refuses enforcement and returns actionable reasons

#### Scenario: New rubric remains advisory

- **WHEN** the current definition identity is not covered by the calibration
- **THEN** the result is advisory and cannot block

### Requirement: Gate result is understandable and separates quality from authority

The decision MUST include `pass`, `fail`, or `indeterminate`, execution mode, a deterministic localized summary, criterion-level messages, evidence IDs, and next steps. Any mandatory supported unacceptable finding MUST make the overall quality outcome fail even if another criterion is indeterminate; all remaining indeterminate findings MUST still be shown. Without a supported failure, any mandatory indeterminate finding MUST make the overall outcome indeterminate. Only all-supported acceptable mandatory criteria may pass. Missing, unavailable, truncated, contradictory, or unsupported evidence and execution failures MUST NOT by themselves become quality failures. Optional findings MUST remain advisory. Chinese is the default display language; English MUST be supported without changing calibration identity. A decision MUST contain at most one finding per criterion, and its validator MUST reject an overall quality outcome that conflicts with the findings.

A decisive unacceptable result for an optional criterion MUST show the matching anchor while remaining explicitly non-blocking. When valid evidence is present but repeated verdicts are `unknown` or `insufficient`, the finding MUST identify a Judge abstention rather than claim evidence is missing; it MUST remain indeterminate and MUST NOT request evidence as though absence were established.

#### Scenario: Supported failure takes precedence while other items remain visible

- **WHEN** one mandatory criterion is evidence-backed unacceptable and another lacks evidence
- **THEN** the overall result is fail and both the failure and pending item are shown

#### Scenario: Missing evidence remains indeterminate

- **WHEN** a mandatory criterion has no supported decisive verdict and no other mandatory failure exists
- **THEN** the result is indeterminate and names the evidence needed next

#### Scenario: Judge abstains despite available evidence

- **WHEN** valid, available evidence is present but all repeated verdicts are `unknown` or `insufficient`
- **THEN** the result is indeterminate, reports a Judge abstention, and does not mislabel the evidence as missing

#### Scenario: Optional unacceptable result stays advisory and specific

- **WHEN** an optional criterion has a clear verdict outside the accepted range
- **THEN** its finding names the matching anchor, remains advisory, and says it does not block overall acceptance

#### Scenario: Uncalibrated judge gives a reference result

- **WHEN** there is enough evidence to assess the work but no verified calibration applies
- **THEN** the result remains informative in the configured advisory mode and cannot block unrelated work

### Requirement: Failure causes are evidence-based

Reports MUST distinguish quality errors, abstentions, execution failures, input/label failures, and disagreement. More specific rubric, fixture, evidence, prompt, provider, threshold, or noise attribution MUST be emitted only when supplied diagnostics support it; otherwise the cause remains unassigned. Gate findings MUST retain supplied failure categories and render them in human-readable language. A gate decision MUST use `unattributed_failure` when the supplied failure category does not establish a more specific cause, and its message MUST NOT guess the root cause.

#### Scenario: Root cause is not inferable

- **WHEN** a wrong measurement has no diagnostic evidence identifying its cause
- **THEN** the report records an unattributed error rather than guessing
