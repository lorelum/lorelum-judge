import { Ajv, type ErrorObject } from "ajv";

import type { Criterion } from "./generated/criterion.js";
import type { Verdict } from "./generated/verdict.js";
import criterionSchema from "./schemas/criterion.schema.json" with { type: "json" };
import verdictSchema from "./schemas/verdict.schema.json" with { type: "json" };

export type { Anchor, Criterion, EvidenceSelector, Source } from "./generated/criterion.js";
export type { Verdict } from "./generated/verdict.js";

export type CriterionKind = Criterion["kind"];
export type VerdictValue = Verdict["verdict"];

export const decisiveVerdicts: Readonly<Record<CriterionKind, readonly VerdictValue[]>> = {
  contract: ["met", "unmet"],
  quality: ["strong", "adequate", "weak"],
  comparison: ["better", "equivalent", "worse"],
};

export const nonDecisiveVerdicts: readonly VerdictValue[] = ["unknown", "insufficient"];

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
  | "invalid_criterion";

export interface ValidationIssue {
  readonly path: string;
  readonly code: IssueCode;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const ajv = new Ajv({ allErrors: true, strict: true });
const checkCriterion = ajv.compile<Criterion>(criterionSchema);
const checkVerdict = ajv.compile<Verdict>(verdictSchema);

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

function schemaIssues(errors: readonly ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: pointerToPath(error.instancePath),
    code: "schema",
    message: `${error.keyword}: ${error.message ?? "invalid"}`,
  }));
}

function isDecisive(kind: CriterionKind, verdict: VerdictValue): boolean {
  return decisiveVerdicts[kind].includes(verdict);
}

export function validateCriterion(input: unknown): ValidationResult<Criterion> {
  if (!checkCriterion(input)) {
    return { ok: false, issues: schemaIssues(checkCriterion.errors) };
  }

  const expected = decisiveVerdicts[input.kind];
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];

  for (const [index, anchor] of input.anchors.entries()) {
    if (!expected.includes(anchor.verdict)) {
      issues.push({
        path: `$.anchors[${index}]`,
        code: "anchor_mismatch",
        message: `${input.kind} criterion has no verdict "${anchor.verdict}"`,
      });
    } else if (seen.has(anchor.verdict)) {
      issues.push({
        path: `$.anchors[${index}]`,
        code: "anchor_mismatch",
        message: `duplicate anchor for "${anchor.verdict}"`,
      });
    }
    seen.add(anchor.verdict);
  }
  for (const verdict of expected) {
    if (!seen.has(verdict)) {
      issues.push({
        path: "$.anchors",
        code: "anchor_mismatch",
        message: `missing anchor for "${verdict}"`,
      });
    }
  }

  const declared = new Set<string>();
  for (const [index, selector] of input.evidence.entries()) {
    if (declared.has(selector.evidenceId)) {
      issues.push({
        path: `$.evidence[${index}]`,
        code: "duplicate_evidence",
        message: `evidence "${selector.evidenceId}" is declared more than once`,
      });
    }
    declared.add(selector.evidenceId);
  }

  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}

export function validateCriteria(input: unknown): ValidationResult<readonly Criterion[]> {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ path: "$", code: "schema", message: "criteria must be an array" }],
    };
  }

  const issues: ValidationIssue[] = [];
  const criteria: Criterion[] = [];
  const ids = new Set<string>();
  const primaryOwner = new Map<string, string>();

  for (const [index, item] of input.entries()) {
    const result = validateCriterion(item);
    if (!result.ok) {
      issues.push(
        ...result.issues.map((issue) => ({ ...issue, path: `$[${index}]${issue.path.slice(1)}` })),
      );
      continue;
    }
    const criterion = result.value;
    criteria.push(criterion);

    if (ids.has(criterion.id)) {
      issues.push({
        path: `$[${index}].id`,
        code: "duplicate_criterion",
        message: `criterion id "${criterion.id}" is used more than once`,
      });
    }
    ids.add(criterion.id);

    for (const selector of criterion.evidence) {
      if (selector.role !== "primary") {
        continue;
      }
      const owner = primaryOwner.get(selector.evidenceId);
      if (owner !== undefined && owner !== criterion.id) {
        issues.push({
          path: `$[${index}].evidence`,
          code: "duplicate_primary_evidence",
          message: `evidence "${selector.evidenceId}" is already primary for "${owner}"`,
        });
      }
      primaryOwner.set(selector.evidenceId, criterion.id);
    }
  }

  return issues.length === 0 ? { ok: true, value: criteria } : { ok: false, issues };
}

export function validateVerdict(
  criterionInput: unknown,
  input: unknown,
): ValidationResult<Verdict> {
  const checkedCriterion = validateCriterion(criterionInput);
  if (!checkedCriterion.ok) {
    return {
      ok: false,
      issues: checkedCriterion.issues.map((issue) => ({
        path: `criterion${issue.path.slice(1)}`,
        code: "invalid_criterion",
        message: `${issue.code}: ${issue.message}`,
      })),
    };
  }
  const criterion = checkedCriterion.value;

  if (!checkVerdict(input)) {
    return { ok: false, issues: schemaIssues(checkVerdict.errors) };
  }

  const issues: ValidationIssue[] = [];

  if (input.criterionId !== criterion.id) {
    issues.push({
      path: "$.criterionId",
      code: "criterion_mismatch",
      message: `verdict is for "${input.criterionId}", expected "${criterion.id}"`,
    });
  }

  const allowed =
    isDecisive(criterion.kind, input.verdict) || nonDecisiveVerdicts.includes(input.verdict);
  if (!allowed) {
    issues.push({
      path: "$.verdict",
      code: "verdict_not_allowed",
      message: `${criterion.kind} criterion does not allow "${input.verdict}"`,
    });
  }

  if (isDecisive(criterion.kind, input.verdict) && input.evidenceIds.length === 0) {
    issues.push({
      path: "$.evidenceIds",
      code: "verdict_without_evidence",
      message: `decisive verdict "${input.verdict}" must cite evidence`,
    });
  }

  const declared = new Set(criterion.evidence.map((selector) => selector.evidenceId));
  for (const [index, evidenceId] of input.evidenceIds.entries()) {
    if (!declared.has(evidenceId)) {
      issues.push({
        path: `$.evidenceIds[${index}]`,
        code: "evidence_not_declared",
        message: `criterion "${criterion.id}" does not declare evidence "${evidenceId}"`,
      });
    }
  }

  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}
