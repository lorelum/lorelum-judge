import { validateCriteria, validateCriterionDraft } from "./criterion.js";
import type { CompilationReport } from "./generated/compilation-report.js";
import type { RubricSet } from "./generated/rubric-set.js";
import { identityOf } from "./identity.js";
import type { JsonValue } from "./json.js";
import { type IdentityOutcome, instrumentIdentity } from "./measurement.js";
import compilationReportSchema from "./schemas/compilation-report.schema.json" with {
  type: "json",
};
import rubricSetSchema from "./schemas/rubric-set.schema.json" with { type: "json" };
import { ANY_TASK_CLASS, taskContractIdentity, validateTaskContract } from "./task-contract.js";
import {
  compileSchema,
  failed,
  guarded,
  prefixIssues,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type { CompilationReport, RubricSet };

const checkRubric = compileSchema<RubricSet>(rubricSetSchema);
const checkReport = compileSchema<CompilationReport>(compilationReportSchema);

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Validates a rubric set on its own. A `proposal` needs only schema-level criteria, so
 * anchors may still be incomplete; a `frozen` set must pass every rule of the criterion
 * validation. In both states criterion ids are unique, `appliesTo` is well formed, and a
 * mandatory criterion has a source.
 */
export function validateRubricSet(input: unknown): ValidationResult<RubricSet> {
  return guarded<ValidationResult<RubricSet>>(() => checkRubricShape(input), failed);
}

function checkRubricShape(raw: unknown): ValidationResult<RubricSet> {
  const input = snapshot(raw);
  if (!checkRubric(input)) {
    return { ok: false, issues: schemaIssues(checkRubric.errors) };
  }
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  for (const [index, entry] of input.entries.entries()) {
    const path = `$.entries[${index}]`;
    const draft = validateCriterionDraft(entry.criterion);
    if (!draft.ok) {
      issues.push(...prefixIssues(draft.issues, `${path}.criterion`));
    }
    if (ids.has(entry.criterion.id) && input.status === "proposal") {
      issues.push({
        path: `${path}.criterion.id`,
        code: "duplicate_criterion",
        message: `criterion id "${entry.criterion.id}" is used more than once`,
      });
    }
    ids.add(entry.criterion.id);
    if (entry.appliesTo.includes(ANY_TASK_CLASS) && entry.appliesTo.length > 1) {
      issues.push({
        path: `${path}.appliesTo`,
        code: "invalid_applicability",
        message: `"${ANY_TASK_CLASS}" must appear alone`,
      });
    }
  }

  if (input.status === "frozen") {
    const full = validateCriteria(input.entries.map((entry) => entry.criterion));
    if (!full.ok) {
      issues.push(
        ...full.issues.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^\$\[(\d+)\]/, "$.entries[$1].criterion"),
        })),
      );
    }
  }

  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}

function appliesTo(appliesToList: readonly string[], taskClass: string): boolean {
  return appliesToList.includes(ANY_TASK_CLASS) || appliesToList.includes(taskClass);
}

/**
 * Checks a rubric against the contract it claims to be written for: same identity, every
 * covered acceptance id exists, and every entry applies to the contract's task class.
 */
export function validateRubricAgainstContract(
  rubricInput: unknown,
  contractInput: unknown,
): ValidationResult<RubricSet> {
  return guarded<ValidationResult<RubricSet>>(
    () => checkRubricAgainst(rubricInput, contractInput),
    failed,
  );
}

function checkRubricAgainst(rubricRaw: unknown, contractRaw: unknown): ValidationResult<RubricSet> {
  const rubricInput = snapshot(rubricRaw);
  const contractInput = snapshot(contractRaw);
  const contract = validateTaskContract(contractInput);
  if (!contract.ok) {
    return { ok: false, issues: prefixIssues(contract.issues, "$.contract") };
  }
  const rubric = validateRubricSet(rubricInput);
  if (!rubric.ok) {
    return rubric;
  }
  const identity = taskContractIdentity(contract.value);
  if (!identity.ok) {
    return identity;
  }

  const issues: ValidationIssue[] = [];
  if (rubric.value.contractIdentity !== identity.identity) {
    issues.push({
      path: "$.contractIdentity",
      code: "identity_mismatch",
      message: "the rubric was written for a different task contract",
    });
  }
  const known = new Set(contract.value.acceptance.map((item) => item.id));
  for (const [index, entry] of rubric.value.entries.entries()) {
    const path = `$.entries[${index}]`;
    for (const [coverIndex, acceptanceId] of entry.covers.entries()) {
      if (!known.has(acceptanceId)) {
        issues.push({
          path: `${path}.covers[${coverIndex}]`,
          code: "unknown_acceptance",
          message: `the contract has no acceptance item "${acceptanceId}"`,
        });
      }
    }
    if (!appliesTo(entry.appliesTo, contract.value.taskClass)) {
      issues.push({
        path: `${path}.appliesTo`,
        code: "not_applicable",
        message: `criterion "${entry.criterion.id}" does not apply to task class "${contract.value.taskClass}"`,
      });
    }
  }
  return issues.length === 0 ? { ok: true, value: rubric.value } : { ok: false, issues };
}

/**
 * Checks a compilation report against the contract and rubric it describes. The report is
 * derived: each acceptance id sits in exactly one of covered, uncovered, unsupported, and
 * `covered` lists exactly the criteria whose entries cover it.
 */
export function validateCompilationReport(
  reportInput: unknown,
  rubricInput: unknown,
  contractInput: unknown,
): ValidationResult<CompilationReport> {
  return guarded<ValidationResult<CompilationReport>>(
    () => checkReportAgainst(reportInput, rubricInput, contractInput),
    failed,
  );
}

function checkReportAgainst(
  reportRaw: unknown,
  rubricRaw: unknown,
  contractRaw: unknown,
): ValidationResult<CompilationReport> {
  const reportInput = snapshot(reportRaw);
  const rubricInput = snapshot(rubricRaw);
  const contractInput = snapshot(contractRaw);
  const rubric = validateRubricAgainstContract(rubricInput, contractInput);
  if (!rubric.ok) {
    return { ok: false, issues: prefixIssues(rubric.issues, "$.rubric") };
  }
  const contract = validateTaskContract(contractInput);
  if (!contract.ok) {
    return { ok: false, issues: prefixIssues(contract.issues, "$.contract") };
  }
  if (!checkReport(reportInput)) {
    return { ok: false, issues: schemaIssues(checkReport.errors) };
  }
  const report = reportInput;
  const identity = taskContractIdentity(contract.value);
  if (!identity.ok) {
    return identity;
  }

  const issues: ValidationIssue[] = [];
  const mismatch = (path: string, message: string) =>
    issues.push({ path, code: "report_mismatch", message });

  if (report.contractIdentity !== identity.identity) {
    issues.push({
      path: "$.contractIdentity",
      code: "identity_mismatch",
      message: "the report describes a different task contract",
    });
  }

  const covering = new Map<string, string[]>();
  for (const entry of rubric.value.entries) {
    for (const acceptanceId of entry.covers) {
      covering.set(acceptanceId, [...(covering.get(acceptanceId) ?? []), entry.criterion.id]);
    }
  }

  const placed = new Map<string, string>();
  const place = (acceptanceId: string, list: string, path: string) => {
    const earlier = placed.get(acceptanceId);
    if (earlier !== undefined) {
      mismatch(path, `acceptance "${acceptanceId}" is in both "${earlier}" and "${list}"`);
    }
    placed.set(acceptanceId, earlier ?? list);
  };
  const known = new Set(contract.value.acceptance.map((item) => item.id));
  const checkKnown = (acceptanceId: string, path: string): boolean => {
    if (known.has(acceptanceId)) {
      return true;
    }
    issues.push({
      path,
      code: "unknown_acceptance",
      message: `the contract has no acceptance item "${acceptanceId}"`,
    });
    return false;
  };

  for (const [index, item] of report.covered.entries()) {
    const path = `$.covered[${index}]`;
    if (!checkKnown(item.acceptanceId, `${path}.acceptanceId`)) {
      continue;
    }
    place(item.acceptanceId, "covered", path);
    const expected = sorted(covering.get(item.acceptanceId) ?? []);
    if (expected.length === 0) {
      mismatch(
        path,
        `acceptance "${item.acceptanceId}" is reported covered but no entry covers it`,
      );
    } else if (sorted(item.criterionIds).join("\u0000") !== expected.join("\u0000")) {
      mismatch(
        `${path}.criterionIds`,
        `acceptance "${item.acceptanceId}" is covered by [${expected.join(", ")}]`,
      );
    }
  }
  for (const [list, gaps] of [
    ["uncovered", report.uncovered],
    ["unsupported", report.unsupported],
  ] as const) {
    for (const [index, gap] of gaps.entries()) {
      const path = `$.${list}[${index}]`;
      if (!checkKnown(gap.acceptanceId, `${path}.acceptanceId`)) {
        continue;
      }
      place(gap.acceptanceId, list, path);
      if ((covering.get(gap.acceptanceId) ?? []).length > 0) {
        mismatch(
          path,
          `acceptance "${gap.acceptanceId}" is reported ${list} but an entry covers it`,
        );
      }
    }
  }
  for (const item of contract.value.acceptance) {
    if (!placed.has(item.id)) {
      mismatch("$", `acceptance "${item.id}" is in none of covered, uncovered, unsupported`);
    }
  }

  const present = new Set(rubric.value.entries.map((entry) => entry.criterion.id));
  const survivors = new Set<string>();
  const absorbedBy = new Map<string, string>();
  for (const [index, merge] of report.merged.entries()) {
    const path = `$.merged[${index}]`;
    if (survivors.has(merge.criterionId)) {
      mismatch(
        `${path}.criterionId`,
        `criterion "${merge.criterionId}" has more than one merged record`,
      );
    }
    survivors.add(merge.criterionId);
    if (!present.has(merge.criterionId)) {
      mismatch(
        `${path}.criterionId`,
        `merged criterion "${merge.criterionId}" is not in the rubric`,
      );
    }
    for (const [fromIndex, absorbed] of merge.mergedFrom.entries()) {
      const earlier = absorbedBy.get(absorbed);
      if (earlier !== undefined && earlier !== merge.criterionId) {
        mismatch(
          `${path}.mergedFrom[${fromIndex}]`,
          `"${absorbed}" was merged into both "${earlier}" and "${merge.criterionId}"`,
        );
      }
      absorbedBy.set(absorbed, merge.criterionId);
      if (present.has(absorbed)) {
        mismatch(
          `${path}.mergedFrom[${fromIndex}]`,
          `"${absorbed}" was reported merged away but is still in the rubric`,
        );
      }
    }
  }

  return issues.length === 0 ? { ok: true, value: report } : { ok: false, issues };
}

/** What a rubric depends on besides its own content. */
export interface RubricBinding {
  readonly contract: unknown;
  /** Identity of the repository context the rubric was built from; supplied, not verified. */
  readonly contextIdentity: string;
  readonly instrument: unknown;
  /** Identity of the authoring policy; supplied, not verified. */
  readonly policyIdentity: string;
}

const IDENTITY = /^sha256:[0-9a-f]{64}$/;

/**
 * Identity of a rubric bound to its contract, context, instrument, and policy. Entry
 * order and the order inside `covers` and `appliesTo` do not matter. A change to the
 * rubric's content or status, the contract, the context, the instrument (model, decoding,
 * prompt, runtime, repetitions), or the policy changes it.
 */
export function rubricIdentity(rubricInput: unknown, binding: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => identifyRubric(rubricInput, binding), failed);
}

function identifyRubric(rubricRaw: unknown, bindingRaw: unknown): IdentityOutcome {
  const rubricInput = snapshot(rubricRaw);
  const bindingInput = snapshot(bindingRaw);
  if (typeof bindingInput !== "object" || bindingInput === null) {
    return failed({ path: "$.binding", code: "schema", message: "binding must be an object" });
  }
  const binding = bindingInput as Partial<RubricBinding>;
  const issues: ValidationIssue[] = [];
  for (const field of ["contextIdentity", "policyIdentity"] as const) {
    const value = binding[field];
    if (typeof value !== "string" || !IDENTITY.test(value)) {
      issues.push({
        path: `$.binding.${field}`,
        code: "schema",
        message: "must be sha256: followed by 64 lowercase hex characters",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const rubric = validateRubricAgainstContract(rubricInput, binding.contract);
  if (!rubric.ok) {
    return rubric;
  }
  const contract = taskContractIdentity(binding.contract);
  if (!contract.ok) {
    return { ok: false, issues: prefixIssues(contract.issues, "$.binding.contract") };
  }
  const instrument = instrumentIdentity(binding.instrument);
  if (!instrument.ok) {
    return { ok: false, issues: prefixIssues(instrument.issues, "$.binding.instrument") };
  }

  const entries = [...rubric.value.entries]
    .sort((a, b) =>
      a.criterion.id < b.criterion.id ? -1 : a.criterion.id > b.criterion.id ? 1 : 0,
    )
    .map((entry) => ({
      ...entry,
      covers: sorted(entry.covers),
      appliesTo: sorted(entry.appliesTo),
    }));
  const value = {
    rubric: { ...rubric.value, entries },
    contract: contract.identity,
    context: binding.contextIdentity,
    instrument: instrument.identity,
    policy: binding.policyIdentity,
  };
  const result = identityOf(rubric.value.schema, value as unknown as JsonValue);
  return result.ok
    ? { ok: true, identity: result.identity }
    : {
        ok: false,
        issues: [
          { path: result.error.path, code: "schema", message: `identity: ${result.error.reason}` },
        ],
      };
}
