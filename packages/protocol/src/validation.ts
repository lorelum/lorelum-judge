import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import codeEvaluationSchema from "./schemas/code-evaluation.schema.json" with { type: "json" };
import criterionSchema from "./schemas/criterion.schema.json" with { type: "json" };
import evidenceBundleSchema from "./schemas/evidence-bundle.schema.json" with { type: "json" };
import evidenceItemSchema from "./schemas/evidence-item.schema.json" with { type: "json" };
import measurementRunSchema from "./schemas/measurement-run.schema.json" with { type: "json" };
import codeExecutionSchema from "./schemas/review-execution-v2.schema.json" with { type: "json" };
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
  | "invalid_entry"
  | "unknown_acceptance"
  | "duplicate_acceptance"
  | "report_mismatch";

/** Canonical identity shape accepted in v2 records. */
export const SHA256_IDENTITY = /^sha256:[0-9a-f]{64}$/;

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

/** The reasons an identity can report; `unsupported` covers everything else. */
export type CopyReason = "undefined" | "not_finite" | "bigint" | "unsupported";

/** A value the copy cannot represent exactly, with the path where it stopped. */
export class CopyError extends Error {
  readonly path: string;
  readonly reason: CopyReason;
  /** The message without the path, for callers that report the path separately. */
  readonly detail: string;

  constructor(path: string, message: string, reason: CopyReason = "unsupported") {
    super(`${path}: ${message}`);
    this.name = "CopyError";
    this.path = path;
    this.reason = reason;
    this.detail = message;
  }
}

type Mode = "strict" | "identity";

/**
 * Reads untrusted input once into plain data and returns the copy. Everything after
 * this works on the copy, so validation and hashing see the same data, and inherited
 * properties cannot be validated but never hashed.
 *
 * Only plain objects (prototype `Object.prototype` or `null`) and arrays are accepted.
 * Own enumerable string keys are copied and each value is read exactly once; `toJSON`
 * is never called, so a `Date`, a boxed primitive, or a class instance is rejected
 * rather than turned into something else. An own property whose value is `undefined`
 * is kept, so validators see the input as written. Rejected, each with the path:
 * functions, symbols, bigints, non-finite numbers, lone surrogates (in values and keys),
 * array holes, `undefined` array elements, extra own properties on arrays, symbol keys,
 * non-enumerable own properties, cycles, and any input whose reading throws. Throws
 * `CopyError` for the rejections, including a getter that throws (reported at the
 * property it reads).
 */
export function snapshot(input: unknown): unknown {
  return copyValue(input, "$", new Set(), "strict");
}

/**
 * The copy used before identity. It rejects exactly what `snapshot` rejects, except that
 * it also rejects `undefined` values (in properties and array elements), so that the
 * first defect in traversal order is reported with its own reason: `undefined`,
 * `not_finite`, `bigint`, or `unsupported`. Identity reports that first defect.
 */
export function snapshotForIdentity(input: unknown): unknown {
  return copyValue(input, "$", new Set(), "identity");
}

function copyValue(value: unknown, path: string, ancestors: Set<object>, mode: Mode): unknown {
  switch (typeof value) {
    case "string":
      if (loneSurrogate.test(value)) {
        throw new CopyError(path, "a lone surrogate is not allowed");
      }
      return value;
    case "boolean":
      return value;
    case "undefined":
      if (mode === "identity") {
        throw new CopyError(path, "undefined is not allowed", "undefined");
      }
      return value;
    case "bigint":
      throw new CopyError(path, "a bigint is not allowed", "bigint");
    case "number":
      if (!Number.isFinite(value)) {
        throw new CopyError(path, `${value} is not allowed`, "not_finite");
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
    if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) {
      throw new CopyError(path, "only plain arrays are allowed");
    }
    return Array.isArray(value)
      ? copyArray(value, path, ancestors, mode)
      : copyObject(value, path, ancestors, mode);
  } catch (error) {
    if (error instanceof CopyError) {
      throw error;
    }
    // Anything else raised while reading this node (a Proxy trap, a stack overflow) is
    // attributed to the node, so identity can report where it happened.
    throw new CopyError(path, error instanceof Error ? error.message : String(error));
  } finally {
    ancestors.delete(value);
  }
}

function copyArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
  mode: Mode,
): unknown[] {
  // The length is read once: the copy must not depend on how often it is asked for it.
  const length = value.length;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue;
    }
    if (typeof key === "symbol" || !isArrayIndex(key, length)) {
      throw new CopyError(path, "an array may only have its elements as own properties");
    }
    if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable) {
      throw new CopyError(`${path}[${key}]`, "only own enumerable properties are allowed");
    }
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const where = `${path}[${index}]`;
    if (!Object.hasOwn(value, index)) {
      // A hole reads as `undefined` to the identity's traversal, so identity reports it so.
      throw new CopyError(
        where,
        "an array hole is not allowed",
        mode === "identity" ? "undefined" : "unsupported",
      );
    }
    const element = copyValue(
      readAt(() => value[index], where),
      where,
      ancestors,
      mode,
    );
    if (element === undefined) {
      throw new CopyError(where, "undefined is not allowed in an array");
    }
    copy.push(element);
  }
  return copy;
}

/**
 * Reads a property. A getter that throws becomes a `CopyError` at the property's path,
 * keeping the original message, so identity can report where the read failed.
 */
function readAt(read: () => unknown, where: string): unknown {
  try {
    return read();
  } catch (error) {
    throw new CopyError(where, error instanceof Error ? error.message : String(error));
  }
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function copyObject(value: object, path: string, ancestors: Set<object>, mode: Mode): object {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CopyError(path, "only plain objects and arrays are allowed");
  }
  const copy: Record<string, unknown> = {};
  // Structure first: every key is checked before any value is read, so a defect in this
  // node's own keys is reported before a defect in one of its children.
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
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
  }
  for (const key of keys as string[]) {
    const where = `${path}.${key}`;
    // The getter, if any, runs exactly once here.
    const copied = copyValue(
      readAt(() => (value as Record<string, unknown>)[key], where),
      where,
      ancestors,
      mode,
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
ajv.addSchema([
  criterionSchema,
  verdictSchema,
  evidenceItemSchema,
  evidenceBundleSchema,
  measurementRunSchema,
  codeEvaluationSchema,
  codeExecutionSchema,
]);

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
    const detail =
      error instanceof CopyError
        ? error.detail
        : error instanceof Error
          ? error.message
          : "unknown error";
    return failure({
      path: error instanceof CopyError ? error.path : "$",
      code: "schema",
      message: `input could not be read: ${detail}`,
    });
  }
}
