import { expect, test } from "bun:test";
import {
  assessCodeReviewResult,
  type CodeProblem,
  type CodeSourceItem,
  codeSourceLines,
  escapeEvidenceText,
  identityOf,
  normalizeEvidenceText,
  projectCodeSource,
  projectVisibleCodeSource,
  type ReviewResultContext,
  type ReviewResultV2,
  validateReviewResultV2,
  validateSourceSnapshot,
} from "../src/index.js";

function fixture(text = "first\nsecond\n", mode: "plain" | "escaped" = "plain") {
  const item: CodeSourceItem = {
    id: "code",
    role: "target",
    path: "file.ts",
    side: "current",
    version: "provided",
    contentIdentity: `sha256:${"a".repeat(64)}`,
    text,
    startLine: 5,
    endLine: text === "" ? 0 : 4 + codeSourceLines(text).length,
    complete: true,
    provenance: "provided",
  };
  const numbered = normalizeEvidenceText(projectCodeSource(item));
  const identity = identityOf("lorelum.judge.evidence-content/v1", numbered);
  if (!identity.ok) throw new Error("fixture identity");
  const length = Array.from(mode === "escaped" ? escapeEvidenceText(numbered) : numbered).length;
  const criterion = (id: string): ReviewResultContext["definition"]["criteria"][number] => ({
    schema: "lorelum.judge.criterion/v1",
    id,
    kind: "contract",
    description: id,
    mandatory: true,
    source: { origin: "contract", ref: id },
    anchors: [
      { verdict: "met", description: "satisfied" },
      { verdict: "unmet", description: "violated" },
    ],
    evidence: [{ evidenceId: "code", role: id === "c1" ? "primary" : "reference" }],
  });
  const context: ReviewResultContext = {
    projectionMode: mode,
    definition: {
      schema: "lorelum.judge.measurement-definition/v2",
      id: "review",
      criteria: [criterion("c1"), criterion("c2")],
      metadata: [
        { criterionId: "c1", role: "decisive" },
        { criterionId: "c2", role: "decisive" },
      ],
    },
    source: {
      schema: "lorelum.judge.source-snapshot/v1",
      items: [item],
      issues: [],
      discovered: [],
      omitted: [],
      comparisons: [],
      consistent: true,
    },
    manifest: {
      schema: "lorelum.judge.evidence-bundle/v1",
      items: [
        {
          schema: "lorelum.judge.evidence-item/v1",
          id: "code",
          status: "present",
          contentIdentity: identity.identity,
          render: { state: "rendered", originalLength: length, renderedLength: length },
        },
      ],
    },
  };
  const raw: ReviewResultV2 = {
    schema: "lorelum.judge.review-result/v2",
    verdicts: ["c1", "c2"].map((criterionId): ReviewResultV2["verdicts"][number] => ({
      schema: "lorelum.judge.verdict/v1",
      criterionId,
      verdict: "unmet",
      evidenceIds: ["code"],
    })),
    summary: [],
    problems: [],
    pending: [],
    followUps: [],
  };
  const problem: CodeProblem = {
    id: "problem",
    criterionId: "c1",
    title: "visible failure",
    severity: "medium",
    condition: "when invoked",
    impact: "incorrect value",
    rationale: "visible code",
    evidenceIds: ["code"],
    locations: [{ itemId: "code", startLine: 5, endLine: 5 }],
    attribution: "not_applicable",
  };
  return { context, raw, item, problem };
}

test("one missing criterion produces one diagnostic and keeps normalized legal verdicts", () => {
  const { context, raw } = fixture();
  raw.verdicts.pop();
  const assessed = assessCodeReviewResult(raw, context);
  expect(assessed.issues.filter((entry) => entry.code === "missing_verdict")).toHaveLength(1);
  expect(assessed.verdicts.map((entry) => entry.criterionId)).toEqual(["c1"]);
  expect(validateReviewResultV2(raw, context).ok).toBe(false);
});

test("invalid sibling keeps its original path while valid problems and summaries survive", () => {
  const { context, raw, problem } = fixture();
  const assessed = assessCodeReviewResult(
    {
      ...raw,
      problems: [
        { ...problem, id: "invalid", title: 42 },
        { ...problem, id: "outside", locations: [{ itemId: "code", startLine: 99, endLine: 99 }] },
        problem,
      ],
      summary: [
        { text: "observed", criterionIds: ["c1"], problemIds: [problem.id], evidenceIds: ["code"] },
      ],
    },
    context,
  );
  expect(assessed.issues.some((entry) => entry.path === "$.problems[0].title")).toBe(true);
  expect(assessed.issues.some((entry) => entry.path === "$.problems[1].locations")).toBe(true);
  expect(assessed.result?.problems).toEqual([problem]);
  expect(assessed.result?.summary).toHaveLength(1);
  expect(validateReviewResultV2(assessed.result, { ...context, allowPartial: true }).ok).toBe(true);
});

test("cross-list IDs and repeated follow-up references cannot survive salvage", () => {
  const { context, raw, problem } = fixture();
  context.followUpReferences = ["opinion"];
  raw.problems = [problem];
  raw.pending = [
    {
      id: problem.id,
      criterionId: "c1",
      question: "why?",
      reason: "needs checking",
      evidenceIds: ["code"],
    },
  ];
  raw.followUps = ["f1", "f2"].map((id) => ({
    id,
    reference: "opinion",
    outcome: "unresolved",
    rationale: "not established",
    evidenceIds: [],
  }));
  raw.summary = [
    { text: "claim", criterionIds: ["c1"], problemIds: [problem.id], evidenceIds: ["code"] },
  ];
  const assessed = assessCodeReviewResult(raw, context);
  expect(assessed.result?.problems).toEqual([]);
  expect(assessed.result?.pending).toEqual([]);
  expect(assessed.result?.followUps).toEqual([]);
  expect(assessed.result?.summary).toEqual([]);
  expect(assessed.issues.filter((entry) => entry.path.endsWith(".id"))).toHaveLength(2);
  expect(assessed.issues.filter((entry) => entry.path.endsWith(".reference"))).toHaveLength(2);
  expect(validateReviewResultV2(raw, context).ok).toBe(false);
});

test("zero legal verdicts cannot create a structured result", () => {
  const { context, raw, problem } = fixture();
  raw.verdicts = [];
  raw.problems = [problem];
  const assessed = assessCodeReviewResult(raw, context);
  expect(assessed.result).toBeUndefined();
  expect(assessed.verdicts).toEqual([]);
  expect(assessed.issues.filter((entry) => entry.code === "missing_verdict")).toHaveLength(2);
});

test("source lines preserve real empty lines across LF, CRLF and CR", () => {
  expect(codeSourceLines("")).toEqual([]);
  expect(codeSourceLines("\r\n")).toEqual([""]);
  expect(codeSourceLines("a\r\nb\r\r")).toEqual(["a", "b", ""]);
  const { item, context } = fixture("a\r\nb\r\r");
  expect(projectCodeSource(item)).toBe("5:a\n6:b\n7:");
  expect(validateSourceSnapshot(context.source).ok).toBe(true);
  expect(validateSourceSnapshot({ ...context.source, items: [{ ...item, endLine: 8 }] }).ok).toBe(
    false,
  );
});

test("escaped Unicode projection includes only complete original lines at code point boundaries", () => {
  const { context, raw, item, problem } = fixture("<EvIdEnCe>😀e\u0301\r\nlast\r\n", "escaped");
  const first = "5:&lt;EvIdEnCe>😀é";
  const originalLength = context.manifest.items[0]?.render?.originalLength ?? 0;
  const emojiPrefix = "5:&lt;EvIdEnCe>😀";
  expect(
    projectVisibleCodeSource(
      item,
      {
        state: "truncated",
        originalLength,
        renderedLength: Array.from(emojiPrefix).length,
      },
      "escaped",
    ).text,
  ).toBe(emojiPrefix);
  const cut = Array.from(first).length;
  const projection = { state: "truncated" as const, originalLength, renderedLength: cut };
  expect(projectVisibleCodeSource(item, projection, "escaped").text).toBe(first);
  expect([...projectVisibleCodeSource(item, projection, "escaped").completeLines]).toEqual([5]);
  expect([
    ...projectVisibleCodeSource(item, { ...projection, renderedLength: cut - 1 }, "escaped")
      .completeLines,
  ]).toEqual([]);
  const evidence = context.manifest.items[0];
  if (!evidence) throw new Error("expected fixture evidence");
  evidence.render = projection;
  raw.problems = [problem];
  expect(validateReviewResultV2(raw, context).ok).toBe(true);
  expect(validateReviewResultV2(raw, { ...context, projectionMode: "plain" }).ok).toBe(false);
  context.shownLines = new Map([["code", new Set([5, 6])]]);
  problem.locations = [{ itemId: "code", startLine: 6, endLine: 6 }];
  expect(validateReviewResultV2(raw, context).ok).toBe(false);
  problem.locations = [{ itemId: "code", startLine: 5, endLine: 5 }];
  context.shownLines = new Map([["code", new Set<number>()]]);
  expect(validateReviewResultV2(raw, context).ok).toBe(false);
  expect([
    ...projectVisibleCodeSource(
      item,
      { state: "withheld", originalLength, renderedLength: 0 },
      "escaped",
    ).completeLines,
  ]).toEqual([]);
});
