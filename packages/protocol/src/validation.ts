import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import criterionSchema from "./schemas/criterion.schema.json" with { type: "json" };
import evidenceItemSchema from "./schemas/evidence-item.schema.json" with { type: "json" };
import verdictSchema from "./schemas/verdict.schema.json" with { type: "json" };

export type IssueCode =
  | "schema"
  | "anchor_mismatch"
  | "duplicate_criterion"
  | "duplicate_primary_evidence"
  | "criterion_mismatch"
  | "verdict_not_allowed"
  | "verdict_without_evidence"
  | "evidence_not_declared"
  | "duplicate_evidence"
  | "invalid_criterion"
  | "missing_verdict"
  | "duplicate_verdict"
  | "unknown_criterion"
  | "identity_mismatch"
  | "evidence_item_invalid"
  | "duplicate_evidence_item"
  | "evidence_not_in_bundle"
  | "verdict_unsupported"
  | "invalid_applicability"
  | "not_applicable"
  | "unknown_acceptance"
  | "duplicate_acceptance"
  | "report_mismatch";

export interface ValidationIssue {
  readonly path: string;
  readonly code: IssueCode;
  readonly message: string;
}

/** A failed result with no value; assignable to every `ValidationResult<T>`. */
export interface Failure {
  readonly ok: false;
  readonly issues: readonly ValidationIssue[];
}

export function failed(issue: ValidationIssue): Failure {
  return { ok: false, issues: [issue] };
}

/** Re-roots issue paths written for a sub-record, for example `$.a` becomes `$.prefix.a`. */
export function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, path: `${prefix}${issue.path.slice(1)}` }));
}

/**
 * Reads untrusted input once into plain data: own enumerable properties only, getters
 * read exactly once. Everything after this works on the copy, so validation and hashing
 * see the same data and inherited properties cannot be validated but never hashed.
 * Throws if the input cannot be read; callers run it inside `guarded`.
 */
export function snapshot(input: unknown): unknown {
  if (typeof input === "object" && input !== null) {
    return JSON.parse(JSON.stringify(input));
  }
  return input;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

// One validator holds the schemas that others reference, so `$ref` resolves.
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema([criterionSchema, verdictSchema, evidenceItemSchema]);

/** Compiles a schema against the shared validator. */
export function compileSchema<T>(schema: object): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

/** Converts an RFC 6901 JSON pointer (as reported by ajv) to `$.a[0].b` form. */
function pointerToPath(pointer: string): string {
  if (pointer === "") {
    return "$";
  }
  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  return `$${segments.map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`)).join("")}`;
}

export function schemaIssues(errors: readonly ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: pointerToPath(error.instancePath),
    code: "schema",
    message: `${error.keyword}: ${error.message ?? "invalid"}`,
  }));
}

/**
 * Runs a check and turns anything it throws into a structured failure. Input can
 * be hostile, for example an object whose getter throws; the public contract is
 * that invalid input never throws.
 */
export function guarded<R>(run: () => R, failure: (issue: ValidationIssue) => R): R {
  try {
    return run();
  } catch (error) {
    return failure({
      path: "$",
      code: "schema",
      message: `input could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}
