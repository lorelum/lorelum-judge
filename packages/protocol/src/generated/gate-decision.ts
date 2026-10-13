// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface GateDecision {
schema: "lorelum.judge.gate-decision/v1"
id: string
definitionIdentity: string
instrumentIdentity: string
qualityOutcome: ("pass" | "fail" | "indeterminate")
executionMode: ("enforced" | "shadow" | "diagnostic" | "indeterminate")
summary: string
findings: {
criterionId: string
criterionDescription: string
outcome: ("pass" | "fail" | "indeterminate" | "advisory")
reason: ("acceptable" | "unacceptable" | "missing_evidence" | "unsupported_evidence" | "disagreement" | "execution_failure" | "measurement_failure" | "unattributed_failure" | "calibration_unavailable" | "not_applicable")
failureCategories?: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")[]
message: string
evidenceIds: string[]
requiredEvidenceIds: string[]
nextStep: string
}[]
}
