import { expect, test } from "bun:test";
import {
  type CodeProblem,
  type CodeSuggestionContext,
  type CodeSuggestionReport,
  type CodeSuggestionResult,
  validateCodeSuggestionReport,
  validateCodeSuggestionResult,
} from "../src/index.js";

const identity = `sha256:${"a".repeat(64)}`;
const problem: CodeProblem = {
  id: "p1",
  criterionId: "criterion",
  title: "problem",
  severity: "high",
  condition: "condition",
  impact: "impact",
  rationale: "rationale",
  evidenceIds: ["code"],
  locations: [{ itemId: "code", startLine: 1, endLine: 1 }],
  attribution: "undetermined",
};
const context: CodeSuggestionContext = {
  problems: [problem],
  source: {
    schema: "lorelum.judge.source-snapshot/v1",
    items: [
      {
        id: "code",
        role: "target",
        path: "file.ts",
        side: "current",
        version: "v1",
        contentIdentity: identity,
        text: "one\ntwo",
        startLine: 1,
        endLine: 2,
        complete: true,
        provenance: "provided",
      },
    ],
    issues: [],
    discovered: [],
    omitted: [],
    comparisons: [],
    consistent: true,
  },
  shownLines: new Map([["code", new Set([1])]]),
  evidenceIds: ["code"],
};
const result: CodeSuggestionResult = {
  schema: "lorelum.judge.code-suggestion-result/v1",
  suggestions: [
    {
      id: "s1",
      problemId: "p1",
      evidenceIds: ["code"],
      location: { itemId: "code", startLine: 1, endLine: 1 },
      category: "required",
      problem: "problem",
      priorityRationale: "priority",
      direction: "direction",
      impact: "impact",
      checks: ["check"],
      uncertainPremises: [],
      alternatives: [],
      example: "example",
    },
  ],
  omissions: [],
};
const report: CodeSuggestionReport = {
  schema: "lorelum.judge.code-suggestion-report/v1",
  status: "completed",
  evaluationIdentity: identity,
  sourceIdentity: identity,
  codeIdentity: identity,
  selectedProblemIds: ["p1"],
  result,
  gaps: [],
  limitations: [],
};
const reportContext = { ...context, selectedProblemIds: ["p1"] };

test("valid suggestions and completed reports retain their structured content", () => {
  expect(validateCodeSuggestionResult(result, context).ok).toBe(true);
  expect(validateCodeSuggestionReport(report, reportContext).ok).toBe(true);
});

test("rejects unknown problem, foreign evidence and incomplete projection", () => {
  const suggestion = result.suggestions[0];
  if (!suggestion) throw new Error("missing fixture suggestion");
  for (const change of [
    { problemId: "other" },
    { evidenceIds: ["other"] },
    { location: { itemId: "code", startLine: 1, endLine: 2 } },
    { location: { itemId: "code", startLine: 2, endLine: 1 } },
  ]) {
    expect(
      validateCodeSuggestionResult(
        { ...result, suggestions: [{ ...suggestion, ...change }] },
        context,
      ).ok,
    ).toBe(false);
  }
  const item = context.source.items[0];
  if (!item) throw new Error("missing fixture source");
  const nonCode = {
    ...context,
    source: { ...context.source, items: [{ ...item, role: "requirement" as const }] },
  };
  expect(validateCodeSuggestionResult(result, nonCode).ok).toBe(false);
});

test("omissions reference visible material and cannot impersonate suggestions", () => {
  const omission = {
    id: "o1",
    description: "possible omission",
    evidenceIds: ["code"],
    location: { itemId: "code", startLine: 1, endLine: 1 },
  };
  expect(validateCodeSuggestionResult({ ...result, omissions: [omission] }, context).ok).toBe(true);
  expect(
    validateCodeSuggestionResult(
      { ...result, omissions: [{ ...omission, problemId: "p1" }] },
      context,
    ).ok,
  ).toBe(false);
  expect(
    validateCodeSuggestionResult(
      {
        ...result,
        omissions: [{ ...omission, location: { ...omission.location, startLine: 2, endLine: 2 } }],
      },
      context,
    ).ok,
  ).toBe(false);
});

test("status and selection require explicit gaps for incomplete coverage", () => {
  expect(
    validateCodeSuggestionReport(
      { ...report, result: { ...result, suggestions: [] } },
      reportContext,
    ).ok,
  ).toBe(false);
  const { result: _result, ...withoutResult } = report;
  expect(
    validateCodeSuggestionReport(
      {
        ...withoutResult,
        status: "partial",
        gaps: [{ problemId: "p1", code: "mismatch", message: "changed" }],
      },
      reportContext,
    ).ok,
  ).toBe(true);
  expect(validateCodeSuggestionReport({ ...report, status: "cancelled" }, reportContext).ok).toBe(
    false,
  );
  expect(
    validateCodeSuggestionReport({ ...report, selectedProblemIds: ["other"] }, reportContext).ok,
  ).toBe(false);
});

test("strict structure and duplicate ids are rejected", () => {
  expect(
    validateCodeSuggestionResult(
      { ...result, suggestions: [result.suggestions[0], result.suggestions[0]] },
      context,
    ).ok,
  ).toBe(false);
  expect(validateCodeSuggestionResult({ ...result, extra: true }, context).ok).toBe(false);
  expect(
    validateCodeSuggestionResult(
      { ...result, suggestions: [{ ...result.suggestions[0], checks: [] }] },
      context,
    ).ok,
  ).toBe(false);
});
