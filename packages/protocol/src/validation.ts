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

/** A value the copy cannot represent exactly, with the path where it stopped. */
export class CopyError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "CopyError";
    this.path = path;
  }
}

/**
 * Reads untrusted input once into plain data and returns the copy. Everything after
 * this works on the copy, so validation and hashing see the same data, and inherited
 * properties cannot be validated but never hashed.
 *
 * Only plain objects (prototype `Object.prototype` or `null`) and arrays are accepted.
 * Own enumerable string keys are copied and each value is read exactly once; `toJSON`
 * is never called, so a `Date`, a boxed primitive, or a class instance is rejected
 * rather than turned into something else. An own property whose value is `undefined`
 * is kept, so validators and identity see the input as written. Rejected, each with
 * the path: functions, symbols, bigints, non-finite numbers, lone surrogates (in values
 * and keys), array holes, `undefined` array elements, extra own properties on arrays,
 * symbol keys, non-enumerable own properties, cycles, and any input whose reading throws.
 * Throws `CopyError` for the rejections; a thrown getter propagates as its own error.
 */
export function snapshot(input: unknown): unknown {
  return copyValue(input, "$", new Set(), false);
}

/**
 * The copy used before identity. It is `snapshot` except that `undefined`, `bigint`,
 * non-finite numbers and `undefined` array elements pass through unchanged, so the
 * identity function can report each with its exact path and reason. Everything else
 * `snapshot` rejects is still rejected here.
 */
export function snapshotForIdentity(input: unknown): unknown {
  return copyValue(input, "$", new Set(), true);
}

function copyValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  lenient: boolean,
): unknown {
  switch (typeof value) {
    case "string":
      if (loneSurrogate.test(value)) {
        throw new CopyError(path, "a lone surrogate is not allowed");
      }
      return value;
    case "boolean":
    case "undefined":
      return value;
    case "bigint":
      if (lenient) {
        return value;
      }
      throw new CopyError(path, "a bigint is not allowed");
    case "number":
      if (!Number.isFinite(value) && !lenient) {
        throw new CopyError(path, `${value} is not allowed`);
      }
      return value;
    case "object":
      break;
    default:
      throw new CopyError(path, `a ${typeof value} is not allowed`);
  }
  if (value === null) {
    return null;
  }
  if (ancestors.has(value)) {
    throw new CopyError(path, "a circular reference is not allowed");
  }
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? copyArray(value, path, ancestors, lenient)
      : copyObject(value, path, ancestors, lenient);
  } finally {
    ancestors.delete(value);
  }
}

function copyArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
  lenient: boolean,
): unknown[] {
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue;
    }
    if (typeof key === "symbol" || !isArrayIndex(key, value.length)) {
      throw new CopyError(path, `an array may only have its elements as own properties`);
    }
  }
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const where = `${path}[${index}]`;
    if (!Object.hasOwn(value, index)) {
      throw new CopyError(where, "an array hole is not allowed");
    }
    const element = copyValue(value[index], where, ancestors, lenient);
    if (element === undefined && !lenient) {
      throw new CopyError(where, "undefined is not allowed in an array");
    }
    copy.push(element);
  }
  return copy;
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function copyObject(value: object, path: string, ancestors: Set<object>, lenient: boolean): object {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CopyError(path, "only plain objects and arrays are allowed");
  }
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new CopyError(path, "symbol keys are not allowed");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable) {
      throw new CopyError(`${path}.${key}`, "only own enumerable properties are allowed");
    }
    if (loneSurrogate.test(key)) {
      throw new CopyError(`${path}.${key}`, "a lone surrogate is not allowed in a key");
    }
    // The getter, if any, runs exactly once here.
    const copied = copyValue(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      ancestors,
      lenient,
    );
    // defineProperty, not assignment: a key named `__proto__` must stay an own key.
    Object.defineProperty(copy, key, {
      value: copied,
      enumerable: true,
      writable: true,
      configurable: true,
    });
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
