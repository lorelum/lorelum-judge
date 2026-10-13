// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface CalibrationDataset {
schema: "lorelum.judge.calibration-dataset/v1"
id: string
definitionIdentity: string
instrumentIdentity: string
/**
 * @minItems 1
 */
taskGroups: [{
id: string
taskIdentity: string
split: ("development" | "holdout")
taskClass: string
evidenceShape: string
/**
 * @minItems 1
 */
cases: [{
id: string
criterionId: string
expectedVerdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse")
caseKind: ("decisive" | "equivalent" | "anti" | "partial")
provenance: {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
/**
 * @minItems 1
 */
observations: [({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}), ...(({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}))[]]
}, ...({
id: string
criterionId: string
expectedVerdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse")
caseKind: ("decisive" | "equivalent" | "anti" | "partial")
provenance: {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
/**
 * @minItems 1
 */
observations: [({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}), ...(({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}))[]]
})[]]
}, ...({
id: string
taskIdentity: string
split: ("development" | "holdout")
taskClass: string
evidenceShape: string
/**
 * @minItems 1
 */
cases: [{
id: string
criterionId: string
expectedVerdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse")
caseKind: ("decisive" | "equivalent" | "anti" | "partial")
provenance: {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
/**
 * @minItems 1
 */
observations: [({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}), ...(({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}))[]]
}, ...({
id: string
criterionId: string
expectedVerdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse")
caseKind: ("decisive" | "equivalent" | "anti" | "partial")
provenance: {
origin: ("user" | "policy" | "contract" | "decision")
ref: string
}
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
/**
 * @minItems 1
 */
observations: [({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}), ...(({
id: string
status: "completed"
run: MeasurementRun
evidenceBundle: EvidenceBundle
} | {
id: string
status: "failed"
failureCategory: ("rubric" | "fixture_label" | "evidence" | "prompt" | "provider" | "threshold" | "measurement_noise" | "execution" | "unattributed")
message: string
evidenceBundle?: EvidenceBundle
}))[]]
})[]]
})[]]
}
export interface MeasurementRun {
schema: "lorelum.judge.measurement-run/v1"
id: string
definitionIdentity: string
instrumentIdentity: string
instrumentSource: "declared"
verdicts: Verdict[]
}
export interface Verdict {
schema: "lorelum.judge.verdict/v1"
criterionId: string
verdict: ("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse" | "unknown" | "insufficient")
evidenceIds: string[]
rationale?: string
}
export interface EvidenceBundle {
schema: "lorelum.judge.evidence-bundle/v1"
items: EvidenceItem[]
}
export interface EvidenceItem {
schema: "lorelum.judge.evidence-item/v1"
id: string
status: ("present" | "no_evidence" | "unavailable" | "contradiction")
contentIdentity?: string
render?: {
state: ("rendered" | "withheld" | "truncated")
originalLength: number
renderedLength: number
}
conflictsWith?: string[]
}
