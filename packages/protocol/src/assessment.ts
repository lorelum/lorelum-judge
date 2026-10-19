import { validateVerdict } from "./criterion.js";
import { validateVerdictEvidence } from "./evidence.js";
import type { Criterion } from "./generated/criterion.js";
import type { EvidenceBundle } from "./generated/evidence-bundle.js";
import type { Verdict } from "./generated/verdict.js";
import type { ValidationIssue } from "./validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One issue produced while reading a raw verdict list. `criterionId` is present
 * when the issue can be attributed to a declared criterion; duplicate and
 * missing entries are never resolved by picking one.
 */
export interface AssessmentIssue extends ValidationIssue {
  readonly criterionId?: string;
}

export interface Assessment {
  readonly verdicts: readonly Verdict[];
  readonly issues: readonly AssessmentIssue[];
}

export interface AssessVerdictsOptions {
  /** When present, every verdict must reference evidence in this bundle. */
  readonly bundle?: EvidenceBundle;
  /** When true, every declared criterion must have exactly one verdict. */
  readonly requireAll?: boolean;
  /** Base path for issues; defaults to `$.verdicts`. */
  readonly path?: string;
}

function assessmentIssue(
  path: string,
  code: ValidationIssue["code"],
  message: string,
  criterionId?: string,
): AssessmentIssue {
  return {
    path,
    code,
    message,
    ...(criterionId === undefined ? {} : { criterionId }),
  };
}

/**
 * Canonical verdict-list assessment shared by measurement runs, partial review
 * attempts, review execution, and gate observations. Unknown entries are
 * ignored, duplicate entries are reported and excluded, and missing entries are
 * only reported when `requireAll` is set. With `bundle`, evidence references are
 * validated as well.
 */
export function assessVerdicts(
  criteria: readonly Criterion[],
  rawVerdicts: readonly unknown[],
  options: AssessVerdictsOptions = {},
): Assessment {
  const base = options.path ?? "$.verdicts";
  const issues: AssessmentIssue[] = [];
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const entriesById = new Map<string, { readonly index: number; readonly entry: unknown }[]>();

  for (const [index, entry] of rawVerdicts.entries()) {
    if (!isRecord(entry) || typeof entry.criterionId !== "string") {
      issues.push(
        assessmentIssue(`${base}[${index}]`, "invalid_entry", "a verdict needs a criterionId"),
      );
      continue;
    }
    if (!criteriaById.has(entry.criterionId)) {
      issues.push(
        assessmentIssue(
          `${base}[${index}].criterionId`,
          "unknown_criterion",
          `definition has no criterion "${entry.criterionId}"`,
        ),
      );
      continue;
    }
    const list = entriesById.get(entry.criterionId) ?? [];
    list.push({ index, entry });
    entriesById.set(entry.criterionId, list);
  }

  const verdicts: Verdict[] = [];
  for (const criterion of criteria) {
    const entries = entriesById.get(criterion.id) ?? [];
    if (entries.length === 0) {
      if (options.requireAll === true) {
        issues.push(
          assessmentIssue(
            base,
            "missing_verdict",
            `criterion "${criterion.id}" has no verdict`,
            criterion.id,
          ),
        );
      }
      continue;
    }
    if (entries.length > 1) {
      for (const entry of entries) {
        issues.push(
          assessmentIssue(
            `${base}[${entry.index}].criterionId`,
            "duplicate_verdict",
            `criterion "${criterion.id}" has more than one verdict`,
            criterion.id,
          ),
        );
      }
      continue;
    }
    const only = entries[0];
    if (only === undefined) continue;
    const checked =
      options.bundle === undefined
        ? validateVerdict(criterion, only.entry)
        : validateVerdictEvidence(criterion, only.entry, options.bundle);
    if (!checked.ok) {
      issues.push(
        ...checked.issues.map((issue) =>
          assessmentIssue(
            `${base}[${only.index}]${issue.path.slice(1)}`,
            issue.code,
            issue.message,
            criterion.id,
          ),
        ),
      );
      continue;
    }
    verdicts.push(checked.value);
  }

  return { verdicts, issues };
}
