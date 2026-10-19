import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import {
  CopyError,
  snapshotForIdentity,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type Identity = `sha256:${string}`;

export interface IdentityError {
  readonly path: string;
  readonly reason: "undefined" | "not_finite" | "bigint" | "unsupported";
}

export type IdentityResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly error: IdentityError };

export type ValidatedIdentity =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export type CanonicalResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: IdentityError };

function reasonFor(error: unknown): IdentityError {
  if (error instanceof CopyError) {
    return { path: error.path, reason: error.reason };
  }
  return { path: "$", reason: "unsupported" };
}

/** Identity of an already-validated record, with schema failures passed through. */
export function identifyValidated(
  validated: ValidationResult<{ readonly schema: string }>,
): ValidatedIdentity {
  if (!validated.ok) return validated;
  const result = identityOf(validated.value.schema, validated.value);
  return result.ok
    ? result
    : {
        ok: false,
        issues: [
          {
            path: result.error.path,
            code: "schema",
            message: `identity: ${result.error.reason}`,
          },
        ],
      };
}

/** Canonical form of an already-copied value. */
function canonicalOfCopy(copy: unknown): CanonicalResult {
  const text = canonicalize(copy);
  if (text === undefined) {
    return { ok: false, error: { path: "$", reason: "unsupported" } };
  }
  return { ok: true, text };
}

/**
 * RFC 8785 canonical form of a value. The input is copied first, so a `Date`, a class
 * instance, a throwing getter, or any other input the copy rejects is a failed result.
 */
export function canonicalForm(value: unknown): CanonicalResult {
  let copy: unknown;
  try {
    copy = snapshotForIdentity(value);
  } catch (error) {
    return { ok: false, error: reasonFor(error) };
  }
  return canonicalOfCopy(copy);
}

/**
 * Stable identity of a record: sha256 over the canonical form of
 * `{"schema": schema, "value": value}`. The schema identifier keeps different
 * record types from sharing an identity. The input is copied once, here, before
 * it is hashed, so the identity covers exactly what was read.
 */
export function identityOf(schema: string, value: unknown): IdentityResult {
  let copy: unknown;
  try {
    copy = snapshotForIdentity({ schema, value });
  } catch (error) {
    return { ok: false, error: reasonFor(error) };
  }
  const canonical = canonicalOfCopy(copy);
  if (!canonical.ok) {
    return canonical;
  }
  const digest = createHash("sha256").update(canonical.text, "utf8").digest("hex");
  return { ok: true, identity: `sha256:${digest}` };
}
