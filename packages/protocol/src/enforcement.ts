import { type Identity, identityOf } from "./identity.js";
import {
  definitionIdentity,
  gatePolicyIdentity,
  instrumentIdentity,
  validateCalibration,
  validateGatePolicy,
} from "./measurement.js";
import { guarded, type ValidationIssue } from "./validation.js";

export type EnforcementReason =
  | "invalid_input"
  | "no_calibration"
  | "not_enforced"
  | "definition_mismatch"
  | "instrument_mismatch"
  | "gate_policy_mismatch";

export type Degradation = "diagnostic" | "shadow" | "indeterminate";

export type EnforcementDecision =
  | { readonly enforce: true }
  | {
      readonly enforce: false;
      readonly reasons: readonly EnforcementReason[];
      /** How the measurement runs instead; `indeterminate` when no valid gate policy exists. */
      readonly degradeTo: Degradation;
    };

export interface EnforcementInput {
  readonly definition: unknown;
  readonly instrument: unknown;
  readonly gatePolicy: unknown;
  /** Absent when the measurement has never been calibrated. */
  readonly calibration?: unknown;
}

/**
 * Enforcement is allowed only for an `enforced` calibration whose definition,
 * instrument, and gate policy identities all match the ones in use. Every other
 * case degrades as the gate policy declares. Never throws.
 */
export function evaluateEnforcement(input: EnforcementInput): EnforcementDecision {
  return guarded<EnforcementDecision>(
    () => decide(input),
    () => ({ enforce: false, reasons: ["invalid_input"], degradeTo: "indeterminate" }),
  );
}

function decide(input: EnforcementInput): EnforcementDecision {
  const policy = validateGatePolicy(input.gatePolicy);
  const degradeTo: Degradation = policy.ok ? policy.value.onUncalibrated : "indeterminate";

  const definition = definitionIdentity(input.definition);
  const instrument = instrumentIdentity(input.instrument);
  const gate = gatePolicyIdentity(input.gatePolicy);
  if (!definition.ok || !instrument.ok || !gate.ok) {
    return { enforce: false, reasons: ["invalid_input"], degradeTo };
  }

  if (input.calibration === undefined) {
    return { enforce: false, reasons: ["no_calibration"], degradeTo };
  }
  const calibration = validateCalibration(input.calibration);
  if (!calibration.ok) {
    return { enforce: false, reasons: ["invalid_input"], degradeTo };
  }

  const reasons: EnforcementReason[] = [];
  if (calibration.value.status !== "enforced") {
    reasons.push("not_enforced");
  }
  if (calibration.value.definitionIdentity !== definition.identity) {
    reasons.push("definition_mismatch");
  }
  if (calibration.value.instrumentIdentity !== instrument.identity) {
    reasons.push("instrument_mismatch");
  }
  if (calibration.value.gatePolicyIdentity !== gate.identity) {
    reasons.push("gate_policy_mismatch");
  }

  return reasons.length === 0 ? { enforce: true } : { enforce: false, reasons, degradeTo };
}

export type KeyOutcome =
  | { readonly ok: true; readonly key: Identity }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const identityPattern = /^sha256:[0-9a-f]{64}$/;

/**
 * Cache key over the definition, the instrument, and the set of evidence
 * identities. Evidence is a set: order and duplicates do not change the key.
 */
export function measurementKey(
  definitionInput: unknown,
  instrumentInput: unknown,
  evidenceIdentities: unknown,
): KeyOutcome {
  return guarded<KeyOutcome>(
    () => computeKey(definitionInput, instrumentInput, evidenceIdentities),
    (issue) => ({ ok: false, issues: [issue] }),
  );
}

function computeKey(
  definitionInput: unknown,
  instrumentInput: unknown,
  evidenceIdentities: unknown,
): KeyOutcome {
  const definition = definitionIdentity(definitionInput);
  if (!definition.ok) {
    return {
      ok: false,
      issues: definition.issues.map((issue) => ({
        ...issue,
        path: `definition${issue.path.slice(1)}`,
      })),
    };
  }
  const instrument = instrumentIdentity(instrumentInput);
  if (!instrument.ok) {
    return {
      ok: false,
      issues: instrument.issues.map((issue) => ({
        ...issue,
        path: `instrument${issue.path.slice(1)}`,
      })),
    };
  }

  if (!Array.isArray(evidenceIdentities)) {
    return {
      ok: false,
      issues: [{ path: "evidence", code: "schema", message: "type: must be an array" }],
    };
  }

  const issues: ValidationIssue[] = [];
  const valid = new Set<string>();
  for (const [index, evidence] of evidenceIdentities.entries()) {
    if (typeof evidence === "string" && identityPattern.test(evidence)) {
      valid.add(evidence);
    } else {
      issues.push({
        path: `evidence[${index}]`,
        code: "schema",
        message: "pattern: must be sha256: followed by 64 lowercase hex characters",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const evidence = [...valid].sort();
  const result = identityOf("lorelum.judge.measurement-key/v1", {
    definition: definition.identity,
    instrument: instrument.identity,
    evidence,
  });
  return result.ok
    ? { ok: true, key: result.identity }
    : {
        ok: false,
        issues: [{ path: "$", code: "schema", message: `identity: ${result.error.reason}` }],
      };
}
