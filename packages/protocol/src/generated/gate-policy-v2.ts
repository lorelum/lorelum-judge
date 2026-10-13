// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface GatePolicyV2 {
schema: "lorelum.judge.gate-policy/v2"
id: string
definitionIdentity: string
instrumentIdentity: string
/**
 * @minItems 1
 */
scopes: [{
taskClass: string
evidenceShape: string
/**
 * @minItems 1
 */
criterionIds: [string, ...(string)[]]
}, ...({
taskClass: string
evidenceShape: string
/**
 * @minItems 1
 */
criterionIds: [string, ...(string)[]]
})[]]
/**
 * @minItems 1
 */
criteria: [{
criterionId: string
/**
 * @minItems 1
 */
acceptedVerdicts: [("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse"), ...(("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse"))[]]
/**
 * @minItems 3
 */
requiredCaseKinds: [("decisive" | "equivalent" | "anti" | "partial"), ("decisive" | "equivalent" | "anti" | "partial"), ("decisive" | "equivalent" | "anti" | "partial"), ...(("decisive" | "equivalent" | "anti" | "partial"))[]]
}, ...({
criterionId: string
/**
 * @minItems 1
 */
acceptedVerdicts: [("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse"), ...(("met" | "unmet" | "strong" | "adequate" | "weak" | "better" | "equivalent" | "worse"))[]]
/**
 * @minItems 3
 */
requiredCaseKinds: [("decisive" | "equivalent" | "anti" | "partial"), ("decisive" | "equivalent" | "anti" | "partial"), ("decisive" | "equivalent" | "anti" | "partial"), ...(("decisive" | "equivalent" | "anti" | "partial"))[]]
})[]]
minimumAgreement: number
minimumGroupsPerCaseKind: number
confidenceLevel: (0.9 | 0.95 | 0.99)
maximumFalseAcceptRate: number
maximumFalseRejectRate: number
maximumAbstentionRate: number
maximumDisagreementRate: number
onUncalibrated: ("diagnostic" | "shadow" | "indeterminate")
}
