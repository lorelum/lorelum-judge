import type { CodeLocation, CodeProblem, SourceSnapshot } from "./code-evaluation.js";
import schema from "./schemas/code-suggestion.schema.json" with { type: "json" };
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

/** Advice is informational: neither its category nor an example authorizes execution. */
export interface CodeSuggestion {
  id: string;
  problemId: string;
  evidenceIds: string[];
  location: CodeLocation;
  category: "required" | "optional" | "preference";
  problem: string;
  priorityRationale: string;
  direction: string;
  impact: string;
  /** Proposed checks, not executed checks. */
  checks: string[];
  uncertainPremises: string[];
  alternatives: { direction: string; applicability: string; tradeoffs: string }[];
  /** An illustrative, unverified example. */
  example?: string;
}

/** A suspected omission always requires a separate evaluation; it is not a finding. */
export interface SuspectedCodeOmission {
  id: string;
  description: string;
  evidenceIds: string[];
  location: CodeLocation;
}

export interface CodeSuggestionResult {
  schema: "lorelum.judge.code-suggestion-result/v1";
  suggestions: CodeSuggestion[];
  omissions: SuspectedCodeOmission[];
}

export interface CodeSuggestionMethod {
  kind: "llm";
  provider: { protocol: string; adapterVersion: string };
  endpointIdentity: string;
  model: { provider: string; name: string; version?: string };
  decoding?: { temperature?: number; topP?: number; maxTokens?: number; seed?: number };
}

export interface CodeSuggestionReport {
  schema: "lorelum.judge.code-suggestion-report/v1";
  status: "completed" | "partial" | "failed" | "cancelled";
  evaluationIdentity: string;
  sourceIdentity: string;
  codeIdentity: string;
  selectedProblemIds: string[];
  result?: CodeSuggestionResult;
  gaps: { problemId?: string; code: string; message: string }[];
  limitations: string[];
  method?: CodeSuggestionMethod;
  responseMetadata?: {
    provider?: string;
    model?: string;
    responseId?: string;
    finishReason?: string;
    status?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  };
  requestIdentity?: string;
  responseIdentity?: string;
  error?: string;
}

export interface CodeSuggestionContext {
  problems: readonly CodeProblem[];
  source: SourceSnapshot;
  /** Complete source lines actually visible in this call's model projection. */
  shownLines: ReadonlyMap<string, ReadonlySet<number>>;
  evidenceIds: readonly string[];
}
export interface CodeSuggestionReportContext extends CodeSuggestionContext {
  selectedProblemIds: readonly string[];
}

compileSchema(schema);
const checkResult = compileSchema<CodeSuggestionResult>({ $ref: `${schema.$id}#/$defs/result` });
const checkReport = compileSchema<CodeSuggestionReport>({ $ref: `${schema.$id}#/$defs/report` });
const issue = (path: string, message: string): ValidationIssue => ({
  path,
  code: "report_mismatch",
  message,
});

/** Validates references against the selected findings and actual model-visible complete lines. */
export function validateCodeSuggestionResult(
  raw: unknown,
  context: CodeSuggestionContext,
): ValidationResult<CodeSuggestionResult> {
  return guarded<ValidationResult<CodeSuggestionResult>>(() => {
    const value = snapshot(raw);
    if (!checkResult(value)) return { ok: false, issues: schemaIssues(checkResult.errors) };
    const issues: ValidationIssue[] = [];
    const problems = new Map(context.problems.map((problem) => [problem.id, problem]));
    const source = new Map(context.source.items.map((item) => [item.id, item]));
    const available = new Set(context.evidenceIds);
    const ids = new Set<string>();
    const checkLocation = (location: CodeLocation, evidenceIds: string[], path: string) => {
      const item = source.get(location.itemId);
      const visible = context.shownLines.get(location.itemId);
      if (
        !item ||
        (item.role !== "target" && item.role !== "context") ||
        !evidenceIds.includes(location.itemId) ||
        location.startLine < item.startLine ||
        location.endLine > item.endLine ||
        location.endLine < location.startLine
      ) {
        issues.push(issue(path, "location must bind referenced code evidence and its range"));
        return;
      }
      for (let line = location.startLine; line <= location.endLine; line++) {
        if (!visible?.has(line)) {
          issues.push(issue(path, "location contains a line not completely visible to the model"));
          break;
        }
      }
    };
    value.suggestions.forEach((suggestion, index) => {
      const path = `$.suggestions[${index}]`;
      if (ids.has(suggestion.id)) issues.push(issue(`${path}.id`, "entry ids must be unique"));
      ids.add(suggestion.id);
      const problem = problems.get(suggestion.problemId);
      if (!problem) issues.push(issue(`${path}.problemId`, "problem must be selected"));
      if (
        suggestion.evidenceIds.some(
          (id) => !available.has(id) || !problem?.evidenceIds.includes(id),
        )
      )
        issues.push(
          issue(
            `${path}.evidenceIds`,
            "evidence must belong to the selected problem and be available",
          ),
        );
      checkLocation(suggestion.location, suggestion.evidenceIds, `${path}.location`);
    });
    value.omissions.forEach((omission, index) => {
      const path = `$.omissions[${index}]`;
      if (ids.has(omission.id)) issues.push(issue(`${path}.id`, "entry ids must be unique"));
      ids.add(omission.id);
      if (omission.evidenceIds.some((id) => !available.has(id)))
        issues.push(issue(`${path}.evidenceIds`, "omission evidence must be available"));
      checkLocation(omission.location, omission.evidenceIds, `${path}.location`);
    });
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}

/** Validates status and coverage in addition to all result references. */
export function validateCodeSuggestionReport(
  raw: unknown,
  context: CodeSuggestionReportContext,
): ValidationResult<CodeSuggestionReport> {
  return guarded<ValidationResult<CodeSuggestionReport>>(() => {
    const value = snapshot(raw);
    if (!checkReport(value)) return { ok: false, issues: schemaIssues(checkReport.errors) };
    const issues: ValidationIssue[] = [];
    const selected = new Set(context.selectedProblemIds);
    if (
      selected.size !== context.selectedProblemIds.length ||
      value.selectedProblemIds.length !== selected.size ||
      value.selectedProblemIds.some((id) => !selected.has(id))
    )
      issues.push(
        issue("$.selectedProblemIds", "report selection must match the requested selection"),
      );
    if (value.result) {
      const result = validateCodeSuggestionResult(value.result, context);
      if (!result.ok) issues.push(...prefixIssues(result.issues, "$.result"));
    }
    for (const gap of value.gaps) {
      if (gap.problemId !== undefined && !selected.has(gap.problemId))
        issues.push(issue("$.gaps", "gap problem must be selected"));
    }
    if (value.status === "completed" || value.status === "partial") {
      const covered = new Set(value.result?.suggestions.map((entry) => entry.problemId) ?? []);
      for (const gap of value.gaps) if (gap.problemId !== undefined) covered.add(gap.problemId);
      for (const id of selected)
        if (!covered.has(id)) issues.push(issue("$.gaps", `selected problem ${id} is not covered`));
    }
    if (
      value.status === "completed" &&
      (!value.result || value.gaps.length !== 0 || selected.size === 0 || value.error !== undefined)
    )
      issues.push(
        issue("$.status", "completed requires a result, selected problems, and no gaps or error"),
      );
    if (value.status === "partial" && value.gaps.length === 0 && value.limitations.length === 0)
      issues.push(issue("$.status", "partial requires an explicit gap or limitation"));
    if ((value.status === "failed" || value.status === "cancelled") && value.result !== undefined)
      issues.push(issue("$.result", "failed or cancelled reports cannot carry a result"));
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}
