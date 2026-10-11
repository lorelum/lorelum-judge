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

const loneSurrogate = /\p{Cs}/u;

/**
 * Reads untrusted input once into plain data and returns the copy. Everything after
 * this works on the copy, so validation and hashing see the same data, and inherited
 * properties cannot be validated but never hashed.
 *
 * Only plain objects (prototype `Object.prototype` or `null`) and arrays are accepted.
 * Own enumerable string keys are copied and each value is read exactly once; `toJSON`
 * is never called, so a `Date`, a boxed primitive, or a class instance is rejected
 * rather than turned into something else. A property whose value is `undefined` is
 * absent from the copy. Functions, symbols, bigints, non-finite numbers, lone
 * surrogates, array holes, `undefined` array elements and cycles are rejected.
 * Throws an error naming the path; callers run it inside `guarded`.
 */
export function snapshot(input: unknown): unknown {
  return copyValue(input, "$", new Set());
}

function copyValue(value: unknown, path: string, ancestors: Set<object>): unknown {
  switch (typeof value) {
    case "string":
      if (loneSurrogate.test(value)) {
        throw new Error(`${path}: a lone surrogate is not allowed`);
      }
      return value;
    case "boolean":
    case "undefined":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`${path}: ${value} is not allowed`);
      }
      return value;
    case "object":
      break;
    default:
      throw new Error(`${path}: a ${typeof value} is not allowed`);
  }
  if (value === null) {
    return null;
  }
  if (ancestors.has(value)) {
    throw new Error(`${path}: a circular reference is not allowed`);
  }
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? copyArray(value, path, ancestors)
      : copyObject(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function copyArray(value: readonly unknown[], path: string, ancestors: Set<object>): unknown[] {
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const where = `${path}[${index}]`;
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${where}: an array hole is not allowed`);
    }
    const element = copyValue(value[index], where, ancestors);
    if (element === undefined) {
      throw new Error(`${where}: undefined is not allowed in an array`);
    }
    copy.push(element);
  }
  return copy;
}

function copyObject(value: object, path: string, ancestors: Set<object>): object {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path}: only plain objects and arrays are allowed`);
  }
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const copied = copyValue((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors);
    if (copied !== undefined) {
      // defineProperty, not assignment: a key named `__proto__` must stay an own key.
      Object.defineProperty(copy, key, {
        value: copied,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return copy;
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
