# judge-review-execution

## ADDED Requirements

### Requirement: Public review defaults to one execution

Judge MUST expose a public review API accepting validated frozen rules, caller-provided evidence and one execution method. It MUST snapshot and identify serializable inputs before execution and MUST reject invalid inputs before invoking a checker or provider. Repetitions MUST default to one and MUST increase only by explicit caller configuration. Calibration datasets MUST NOT be a prerequisite for ordinary advisory review.

#### Scenario: Ordinary single call

- **WHEN** a caller submits valid rules and evidence without a repetition override or calibration
- **THEN** Judge performs one execution and returns findings, completion state and advisory gate information

#### Scenario: Invalid or mutated input

- **WHEN** input is invalid or the caller mutates the source object after a valid execution starts
- **THEN** invalid input causes no execution and later mutation cannot change the frozen execution

### Requirement: Frozen rubric conversion retains decision semantics

A canonical conversion MUST accept only frozen RubricSet records and produce MeasurementDefinition/v2 with original rubric/contract identities, criterion sources, covers, appliesTo and per-criterion roles retained. Only decisive mandatory criteria MUST participate as required conditions. Advisory entries MUST remain non-blocking even when their original mandatory flag is true. Conversion MUST NOT rewrite the original flag or silently drop entries.

#### Scenario: Mandatory source is advisory in this review

- **WHEN** a frozen rubric marks a mandatory criterion advisory
- **THEN** its original requirement and findings remain visible but its verdict cannot determine overall pass or fail

#### Scenario: Proposal is rejected

- **WHEN** conversion receives a proposed rubric
- **THEN** it returns validation issues without creating an executable definition

### Requirement: Method identity represents program and LLM methods honestly

InstrumentProfile/v2 MUST discriminate program and LLM methods. Program methods MUST declare checker identity and version or content identity without fabricated model fields. LLM method identity MUST include provider adapter version, actual endpoint identity, requested model, explicit decoding, rule prompt/compiler/parser identities, runtime and planned repetitions. Credentials MUST NOT enter identity or persistence. Actual evidence and rendered messages MUST identify the execution separately from the reusable rule prompt.

#### Scenario: Endpoint changes

- **WHEN** the same model is requested at a different endpoint
- **THEN** method identity changes and old calibration cannot be automatically reused

#### Scenario: Evidence changes within scope

- **WHEN** only evidence content changes within the calibrated evidence shape and task class
- **THEN** execution identity changes while calibration applicability is checked without automatically expiring calibration solely for that content change

### Requirement: Version evolution preserves existing contracts

New definitions, instruments and complete runs MUST use explicit v2 schemas and schema-specific identities. Existing v1 validators, persisted records and declared-only semantics MUST retain their behavior. Runtime request configuration and response metadata MUST be provider-neutral and compatible with existing message, structured and tool consumers. Calibration loaders and cross-record validators MUST explicitly support new versions without relabeling old artifacts or accepting forged verification.

#### Scenario: Old calibration meets a migrated method

- **WHEN** a v1 caller migrates to a v2 method
- **THEN** identities are recomputed and the old artifact is not automatically made applicable by rewriting its references

### Requirement: Caller-provided program execution shares verdict validation

Judge MUST invoke the caller-provided checker with frozen rules, evidence and cancellation signal, capture thrown and rejected failures, and apply the same criterion and evidence validation as LLM execution. It MUST NOT own test launching or evidence collection. Cancellation MUST stop subsequent invocations and late checker results MUST NOT replace a cancelled outcome.

#### Scenario: Checker returns evidence insufficient

- **WHEN** a checker returns a legal insufficient verdict
- **THEN** it remains a valid finding rather than an execution failure or a quality failure

### Requirement: Provider implements bounded non-streaming text transport

A provider-* package MUST implement OpenAI Chat Completions compatible non-streaming text transport with endpoint, credentials, model, explicit temperature/topP/maxTokens/seed, timeout and cancellation. It MUST NOT compile rubric prompts, interpret verdict JSON, drop configured parameters, switch models, retry or require server-side structured output. Unsupported configuration MUST fail explicitly. Provider-specific SDK types MUST NOT enter protocol or runtime records.

#### Scenario: Request and response use local HTTP

- **WHEN** a local mock receives a configured request
- **THEN** tests verify actual wire parameters and expose whitelisted response metadata without requiring an external service or real credential

#### Scenario: HTTP failure timeout or cancellation

- **WHEN** transport returns an error, times out or receives cancellation
- **THEN** a distinguishable structured outcome is recorded without an automatic retry or fabricated quality verdict

### Requirement: Recorded observations do not certify remote execution

Execution records MUST separate actual sent configuration, server-declared metadata and unknown information. Returned model names MUST NOT constitute proof of remote internals. Known request/response conflicts MUST participate in applicability checks. Endpoint records MUST use a computed identity rather than a raw address; credentials, sensitive headers and unfiltered error bodies MUST NOT be persisted.

#### Scenario: Returned model differs

- **WHEN** a response names a model different from the requested model
- **THEN** the conflict is retained and cannot be silently accepted as a verified match

### Requirement: Compatible reading does not repair assessment content

The default reader MUST accept bare JSON and a single complete JSON or unlabelled Markdown code block with surrounding whitespace. It MUST reject ambiguous wrappers, duplicate JSON object keys and malformed JSON, MUST NOT guess missing verdicts or citations, and MUST NOT make additional model calls to repair responses.

#### Scenario: JSON in a code block

- **WHEN** a response wraps valid JSON in one supported code block
- **THEN** it is read and validated without an extra invocation or assessment-content change

### Requirement: Partial findings remain useful without becoming complete measurements

Each criterion MUST be validated independently after a reliable parse. Legal findings MUST remain visible; missing, duplicate, illegal and unsupported entries MUST carry explicit issues. Duplicate entries MUST NOT be resolved by choosing one. Unknown criterion IDs MUST NOT be counted as expected criteria. MeasurementRun/v2 MUST still require exactly one valid verdict for every criterion. Partial execution MUST NOT fabricate a complete run or successful calibration observation.

#### Scenario: Four legal findings and one omitted item

- **WHEN** a five-criterion response contains four legal findings and one omission
- **THEN** four findings are shown, the fifth is unfinished, execution is partial and no complete measurement is created

#### Scenario: Required failure with another unfinished item

- **WHEN** a decisive mandatory item has sufficient evidence of an unacceptable verdict and another item is unfinished
- **THEN** the supported failure can remain visible and overall quality can fail while execution remains incomplete and original enforcement eligibility is not granted

### Requirement: Execution lifecycle preserves the original plan

ReviewExecution/v1 MUST retain planned count and distinct completed, partial, failed, cancelled and not_started attempts. Explicit repetitions MUST execute sequentially without retry, cache or replacement attempts. Cancellation MUST prevent subsequent starts. Repeated historical identities MUST NOT increase measurement or independent sample counts. Missing and failed slots MUST NOT shrink the original aggregation denominator.

#### Scenario: Cancel an explicit three-attempt review

- **WHEN** the caller explicitly plans three attempts and cancels during the second
- **THEN** the first result, cancelled second attempt and not_started third attempt remain distinct under the original plan of three

### Requirement: Review results integrate with calibrated gate semantics

The public execution-to-gate path MUST reuse #9 aggregation, evidence semantics and verified calibration loading. It MUST support program and LLM v2 methods and partial executions without fabricating verdicts. It MUST separate quality outcome, execution completeness and enforcement mode, retain missing/unavailable/truncated/contradiction statuses, and provide reasons and next steps. Incomplete batches, mismatched identities and missing calibration-required observations MUST degrade enforcement. No applicable calibration MUST still permit advisory review and MUST NOT automatically block delivery.

#### Scenario: Single call does not satisfy a different repetition condition

- **WHEN** a caller asks for one review and presents calibration bound to a different repetition configuration
- **THEN** Judge performs only the requested execution, retains its findings and declines the mismatched enforcement claim

#### Scenario: Required response information is absent

- **WHEN** calibration requires response information that this execution cannot establish
- **THEN** that information remains unknown and enforcement degrades without converting the gap into a quality failure

### Requirement: Public consumers and future workflow boundaries are explicit

Delivery MUST include public package exports, integration documentation and offline runnable program, mock LLM and review-to-gate examples. Built Node ESM exports MUST execute the complete examples in an isolated consumer. Synthetic calibration MUST be labelled demonstration only. #10 MUST NOT implement code-edit workflow, suggestion generation, automatic evidence collection or benchmark migration; its findings MUST preserve enough provenance and completion state for #11 to consume.

#### Scenario: Isolated offline consumer

- **WHEN** an isolated Node ESM consumer loads built package exports
- **THEN** it can execute program and local mock LLM review-to-gate examples without source imports, external models or real keys
