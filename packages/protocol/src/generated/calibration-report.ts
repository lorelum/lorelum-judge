// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface CalibrationReport {
schema: "lorelum.judge.calibration-report/v1"
datasetIdentity: string
policyIdentity: string
definitionIdentity: string
instrumentIdentity: string
confidenceLevel: (0.9 | 0.95 | 0.99)
/**
 * @minItems 1
 */
scopes: [{
taskClass: string
evidenceShape: string
criterionId: string
taskGroups: number
cases: number
observations: number
caseCounts: {
[k: string]: number
}
failureCounts: {
[k: string]: number
}
falseAccept: Rate
falseReject: Rate
abstention: Rate
disagreement: Rate
eligible: boolean
reasons: ("insufficient_coverage" | "missing_denominator" | "false_accept_threshold" | "false_reject_threshold" | "abstention_threshold" | "disagreement_threshold")[]
}, ...({
taskClass: string
evidenceShape: string
criterionId: string
taskGroups: number
cases: number
observations: number
caseCounts: {
[k: string]: number
}
failureCounts: {
[k: string]: number
}
falseAccept: Rate
falseReject: Rate
abstention: Rate
disagreement: Rate
eligible: boolean
reasons: ("insufficient_coverage" | "missing_denominator" | "false_accept_threshold" | "false_reject_threshold" | "abstention_threshold" | "disagreement_threshold")[]
})[]]
}
export interface Rate {
numerator: number
denominator: number
estimate?: number
lowerBound?: number
upperBound?: number
}
