// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.


export interface CalibrationArtifact {
schema: "lorelum.judge.calibration-artifact/v1"
id: string
definitionIdentity: string
instrumentIdentity: string
gatePolicyIdentity: string
status: ("diagnostic" | "shadow" | "provisional" | "enforced" | "expired" | "revoked")
}
