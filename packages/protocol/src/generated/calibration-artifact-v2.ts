// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface CalibrationArtifactV2 {
schema: "lorelum.judge.calibration-artifact/v2"
id: string
definitionIdentity: string
instrumentIdentity: string
datasetIdentity: string
policyIdentity: string
reportIdentity: string
scope: {
taskClass: string
evidenceShape: string
/**
 * @minItems 1
 */
criterionIds: [string, ...(string)[]]
}
scopeIdentity: string
status: ("diagnostic" | "shadow" | "provisional" | "enforced" | "expired" | "revoked")
validFrom: string
validUntil: string
}
