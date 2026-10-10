import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import type { JsonValue } from "./json.js";

export type Identity = `sha256:${string}`;

export interface IdentityError {
  readonly path: string;
  readonly reason: "undefined" | "not_finite" | "bigint" | "unsupported";
}

export type IdentityResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly error: IdentityError };

export type CanonicalResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: IdentityError };

function findUnsupported(value: unknown, path: string): IdentityError | undefined {
  if (value === undefined) {
    return { path, reason: "undefined" };
  }
  if (typeof value === "bigint") {
    return { path, reason: "bigint" };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : { path, reason: "not_finite" };
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const error = findUnsupported(element, `${path}[${index}]`);
      if (error !== undefined) {
        return error;
      }
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      const error = findUnsupported(member, `${path}.${key}`);
      if (error !== undefined) {
        return error;
      }
    }
    return undefined;
  }
  return { path, reason: "unsupported" };
}

/** RFC 8785 canonical form of a value, or the first unsupported value found. */
export function canonicalForm(value: JsonValue): CanonicalResult {
  const error = findUnsupported(value, "$");
  if (error !== undefined) {
    return { ok: false, error };
  }
  const text = canonicalize(value);
  if (text === undefined) {
    return { ok: false, error: { path: "$", reason: "unsupported" } };
  }
  return { ok: true, text };
}

/**
 * Stable identity of a record: sha256 over the canonical form of
 * `{"schema": schema, "value": value}`. The schema identifier keeps different
 * record types from sharing an identity.
 */
export function identityOf(schema: string, value: JsonValue): IdentityResult {
  const canonical = canonicalForm({ schema, value });
  if (!canonical.ok) {
    return canonical;
  }
  const digest = createHash("sha256").update(canonical.text, "utf8").digest("hex");
  return { ok: true, identity: `sha256:${digest}` };
}
