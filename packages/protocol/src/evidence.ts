import { nonDecisiveVerdicts, validateVerdict } from "./criterion.js";
import type { EvidenceBundle } from "./generated/evidence-bundle.js";
import type { EvidenceItem } from "./generated/evidence-item.js";
import type { Verdict } from "./generated/verdict.js";
import { identityOf } from "./identity.js";
import type { JsonValue } from "./json.js";
import type { IdentityOutcome } from "./measurement.js";
import evidenceBundleSchema from "./schemas/evidence-bundle.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type { EvidenceBundle, EvidenceItem };

const checkBundle = compileSchema<EvidenceBundle>(evidenceBundleSchema);
function invalidItem(index: number, message: string): ValidationIssue {
  return { path: `$.items[${index}]`, code: "evidence_item_invalid", message };
}

/** Rules that depend only on one item. */
function itemIssues(item: EvidenceItem, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasContent = item.status === "present" || item.status === "contradiction";

  if (hasContent) {
    if (item.contentIdentity === undefined) {
      issues.push(invalidItem(index, `status "${item.status}" requires contentIdentity`));
    }
    if (item.render === undefined) {
      issues.push(invalidItem(index, `status "${item.status}" requires render`));
    }
  } else {
    if (item.contentIdentity !== undefined) {
      issues.push(invalidItem(index, `status "${item.status}" must not carry contentIdentity`));
    }
    if (item.render !== undefined) {
      issues.push(invalidItem(index, `status "${item.status}" must not carry render`));
    }
  }

  if (item.status === "contradiction") {
    if (item.conflictsWith === undefined || item.conflictsWith.length === 0) {
      issues.push(invalidItem(index, "a contradiction must name what it conflicts with"));
    }
  } else if (item.conflictsWith !== undefined) {
    issues.push(invalidItem(index, `status "${item.status}" must not carry conflictsWith`));
  }

  if (item.render !== undefined) {
    const { state, originalLength, renderedLength } = item.render;
    if (state === "rendered" && renderedLength !== originalLength) {
      issues.push(invalidItem(index, "a rendered item must keep its full length"));
    }
    if (state === "withheld" && renderedLength !== 0) {
      issues.push(invalidItem(index, "a withheld item must keep no text"));
    }
    if (state === "truncated" && (renderedLength === 0 || renderedLength >= originalLength)) {
      issues.push(
        invalidItem(
          index,
          "a truncated item must keep some text, and less than its original length",
        ),
      );
    }
  }
  return issues;
}

/**
 * Validates what evidence existed and what the judge was shown of it. Missing
 * evidence is a recorded status, never an error and never a failing score.
 */
export function validateEvidenceBundle(input: unknown): ValidationResult<EvidenceBundle> {
  return guarded<ValidationResult<EvidenceBundle>>(() => checkBundleShape(input), failed);
}

function checkBundleShape(input: unknown): ValidationResult<EvidenceBundle> {
  if (!checkBundle(input)) {
    return { ok: false, issues: schemaIssues(checkBundle.errors) };
  }
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const [index, item] of input.items.entries()) {
    issues.push(...itemIssues(item, index));
    if (ids.has(item.id)) {
      issues.push({
        path: `$.items[${index}].id`,
        code: "duplicate_evidence_item",
        message: `evidence item "${item.id}" is declared twice`,
      });
    }
    ids.add(item.id);
  }
  for (const [index, item] of input.items.entries()) {
    for (const [conflictIndex, other] of (item.conflictsWith ?? []).entries()) {
      if (other === item.id || !ids.has(other)) {
        issues.push({
          path: `$.items[${index}].conflictsWith[${conflictIndex}]`,
          code: "evidence_not_in_bundle",
          message: `"${other}" is not another item in this bundle`,
        });
      }
    }
  }
  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}

function isSupporting(item: EvidenceItem | undefined): boolean {
  return (
    item !== undefined &&
    item.status === "present" &&
    (item.render?.state === "rendered" || item.render?.state === "truncated") &&
    item.render.renderedLength > 0
  );
}

/**
 * Validates a verdict against its criterion, then against the evidence that was
 * actually available: every cited id must exist, and a decisive verdict must rest
 * on at least one item the judge was shown. `unknown` and `insufficient` may cite
 * nothing.
 */
export function validateVerdictEvidence(
  criterionInput: unknown,
  verdictInput: unknown,
  bundleInput: unknown,
): ValidationResult<Verdict> {
  return guarded<ValidationResult<Verdict>>(
    () => checkVerdictEvidence(criterionInput, verdictInput, bundleInput),
    failed,
  );
}

function checkVerdictEvidence(
  criterionInput: unknown,
  verdictInput: unknown,
  bundleInput: unknown,
): ValidationResult<Verdict> {
  const verdict = validateVerdict(criterionInput, verdictInput);
  if (!verdict.ok) {
    return verdict;
  }
  const bundle = validateEvidenceBundle(bundleInput);
  if (!bundle.ok) {
    return {
      ok: false,
      issues: bundle.issues.map((issue) => ({ ...issue, path: `$.bundle${issue.path.slice(1)}` })),
    };
  }

  const byId = new Map(bundle.value.items.map((item) => [item.id, item]));
  const issues: ValidationIssue[] = [];
  for (const [index, evidenceId] of verdict.value.evidenceIds.entries()) {
    if (!byId.has(evidenceId)) {
      issues.push({
        path: `$.evidenceIds[${index}]`,
        code: "evidence_not_in_bundle",
        message: `verdict cites "${evidenceId}", which the bundle does not contain`,
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const decisive = !nonDecisiveVerdicts.includes(verdict.value.verdict);
  const supported = verdict.value.evidenceIds.some((evidenceId) =>
    isSupporting(byId.get(evidenceId)),
  );
  if (decisive && !supported) {
    return {
      ok: false,
      issues: [
        {
          path: "$.evidenceIds",
          code: "verdict_unsupported",
          message: `decisive verdict "${verdict.value.verdict}" cites no present evidence that was rendered`,
        },
      ],
    };
  }
  return verdict;
}

function sortedBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Identity of a validated bundle. Item order and the order of `conflictsWith` do not
 * matter; any change to an item's content, status, render state, lengths, or
 * conflicts does.
 */
export function evidenceBundleIdentity(input: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => identifyBundle(input), failed);
}

function identifyBundle(input: unknown): IdentityOutcome {
  const bundle = validateEvidenceBundle(input);
  if (!bundle.ok) {
    return bundle;
  }
  const normalized: EvidenceBundle = {
    schema: bundle.value.schema,
    items: sortedBy(bundle.value.items, (item) => item.id).map((item) =>
      item.conflictsWith === undefined
        ? item
        : { ...item, conflictsWith: sortedBy(item.conflictsWith, (id) => id) },
    ),
  };
  const result = identityOf(bundle.value.schema, normalized as unknown as JsonValue);
  return result.ok
    ? { ok: true, identity: result.identity }
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
