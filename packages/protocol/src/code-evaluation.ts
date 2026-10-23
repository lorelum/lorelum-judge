import { escapeEvidenceText, normalizeEvidenceText } from "./evidence-text.js";
import type { EvidenceBundle } from "./generated/evidence-bundle.js";
import type { EvidenceItem } from "./generated/evidence-item.js";
import type { InstrumentProfileV2 } from "./generated/instrument-profile-v2.js";
import type { MeasurementDefinitionV2 } from "./generated/measurement-definition-v2.js";
import type { Verdict } from "./generated/verdict.js";
import type { ReviewAttempt } from "./measurement-v2-execution.js";

export type CodeSourceRole = "target" | "context" | "requirement" | "opinion";
export type CodeSide = "current" | "old" | "new";
export type CodeTarget =
  | { kind: "snippet"; text: string; name?: string; language?: string }
  | { kind: "files"; files: readonly { path: string; text: string; role?: CodeSourceRole }[] }
  | { kind: "diff"; text: string; name?: string }
  | {
      kind: "comparison";
      old: readonly { path: string; text: string }[];
      new: readonly { path: string; text: string }[];
    }
  | { kind: "local"; path: string; ref?: string }
  | {
      kind: "git";
      path: string;
      selection: "staged" | "unstaged" | "untracked" | "commit" | "compare" | "branch" | "working";
      base?: string;
      head?: string;
      paths?: readonly string[];
      parent?: number;
    }
  | { kind: "github"; url: string };
export interface SourceIssue {
  code: string;
  message: string;
  source?: string;
  fatal?: boolean;
}
export interface CodeSourceItem {
  id: string;
  role: CodeSourceRole;
  path: string;
  side: CodeSide;
  version: string;
  contentIdentity: string;
  text: string;
  startLine: number;
  endLine: number;
  complete: boolean;
  provenance: "provided" | "local" | "git" | "github" | "patch";
}
export interface SourceSnapshot {
  schema: "lorelum.judge.source-snapshot/v1";
  items: CodeSourceItem[];
  issues: SourceIssue[];
  discovered: string[];
  omitted: string[];
  comparisons: {
    source: string;
    kind: string;
    base: string;
    head: string;
    mergeBase?: string;
    /** Paths whose absence on the opposite side was established by the reader. */
    addedPaths?: string[];
    deletedPaths?: string[];
  }[];
  consistent: boolean;
}
export interface CodeLocation {
  itemId: string;
  startLine: number;
  endLine: number;
}
export interface CodeProblem {
  id: string;
  criterionId: string;
  title: string;
  severity: "high" | "medium" | "low";
  condition: string;
  impact: string;
  rationale: string;
  evidenceIds: string[];
  locations: CodeLocation[];
  attribution: "introduced" | "amplified" | "pre_existing" | "undetermined" | "not_applicable";
}
export interface PendingObservation {
  id: string;
  criterionId: string;
  question: string;
  reason: string;
  evidenceIds: string[];
}
export interface FollowUp {
  id: string;
  reference: string;
  outcome: "supported" | "conditional" | "unsupported" | "unresolved" | "resolved" | "persists";
  rationale: string;
  evidenceIds: string[];
}
export interface ReviewResultV2 {
  schema: "lorelum.judge.review-result/v2";
  verdicts: Verdict[];
  summary: { text: string; criterionIds: string[]; problemIds: string[]; evidenceIds: string[] }[];
  problems: CodeProblem[];
  pending: PendingObservation[];
  followUps: FollowUp[];
}
export interface ReviewPlan {
  schema: "lorelum.judge.review-plan/v1";
  request: string;
  task: "inspect" | "overview" | "change" | "requirements" | "verify" | "recheck";
  standardsVersion: string;
  definition: MeasurementDefinitionV2;
  sourceIdentity: string;
  evidenceBudget?: number;
  requirements: { id: string; text: string; source: string }[];
  excluded: { id: string; reason: string }[];
  focus: string[];
}
export interface PreparationRecord {
  stage: string;
  status: "completed" | "failed" | "cancelled";
  requestIdentity?: string;
  responseIdentity?: string;
  model?: string;
  error?: string;
}
export type ReviewAttemptV2 = ReviewAttempt & { result?: ReviewResultV2; rawResult?: unknown };
export interface ReviewExecutionV2 {
  schema: "lorelum.judge.review-execution/v2";
  id: string;
  inputIdentity: string;
  definitionIdentity: string;
  instrumentIdentity: string;
  sourceIdentity: string;
  planIdentity: string;
  instrument: InstrumentProfileV2;
  plannedCount: number;
  attempts: [ReviewAttemptV2, ...ReviewAttemptV2[]];
  shownLines?: Record<string, number[]>;
  followUpReferences?: string[];
}
export interface CodeEvaluationReport {
  schema: "lorelum.judge.code-evaluation-report/v1";
  id: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  request: string;
  source: SourceSnapshot;
  sourceIdentity: string;
  plan?: ReviewPlan;
  planIdentity?: string;
  execution?: ReviewExecutionV2;
  preparation: PreparationRecord[];
  result?: ReviewResultV2;
  issues: SourceIssue[];
  limitations: string[];
  previousReportIdentity?: string;
  rendererVersion: string;
}
export interface ReviewResultContext {
  definition: MeasurementDefinitionV2;
  source: SourceSnapshot;
  manifest: EvidenceBundle;
  /** Explicit rendering mode, taken from the actual instrument method. */
  projectionMode: CodeProjectionMode;
  /** Optional caller restriction; can only remove otherwise visible lines. */
  shownLines?: ReadonlyMap<string, ReadonlySet<number>>;
  followUpReferences?: readonly string[];
  allowPartial?: boolean;
}

export type CodeProjectionMode = "plain" | "escaped";

/** A terminal separator ends the last line; it does not create another source line. */
export function codeSourceLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

/** Canonical original-line projection shared by execution and citation validation. */
export function projectCodeSource(item: CodeSourceItem): string {
  return codeSourceLines(item.text)
    .map((line, index) => `${item.startLine + index}:${line}`)
    .join("\n");
}

/** The rendered prefix and original line numbers whose complete contents are visible. */
export function projectVisibleCodeSource(
  item: CodeSourceItem,
  projection: EvidenceItem["render"],
  mode: CodeProjectionMode,
): { text: string; completeLines: ReadonlySet<number>; originalLength: number } {
  const numbered = normalizeEvidenceText(projectCodeSource(item));
  const characters = Array.from(mode === "escaped" ? escapeEvidenceText(numbered) : numbered);
  const text =
    projection?.state === "withheld"
      ? ""
      : characters.slice(0, projection?.renderedLength ?? characters.length).join("");
  const completeLines = new Set<number>();
  const visibleLength = projection?.state === "withheld" ? 0 : Array.from(text).length;
  let offset = 0;
  const rendered = characters.join("");
  if (rendered !== "")
    for (const [index, line] of rendered.split("\n").entries()) {
      offset += Array.from(line).length;
      if (offset <= visibleLength) completeLines.add(item.startLine + index);
      offset += 1;
    }
  return {
    text,
    completeLines,
    originalLength: characters.length,
  };
}
