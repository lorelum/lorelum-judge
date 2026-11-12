import { describe, expect, test } from "bun:test";
import type { ProgramCheckerInput } from "@lorelum/judge";
import { instrumentIdentityV2, measurementDefinitionIdentityV2 } from "@lorelum/judge-protocol";
import type { SandboxPort } from "@lorelum/judge-runtime";
import {
  composeEvidenceReport,
  type EvidenceReviewInput,
  runEvidenceReview,
} from "../src/evidence-review.js";

const definition = {
  schema: "lorelum.judge.measurement-definition/v2",
  id: "review",
  criteria: [
    {
      schema: "lorelum.judge.criterion/v1",
      id: "c1",
      kind: "contract",
      description: "check output",
      mandatory: true,
      source: { origin: "contract", ref: "AC-1" },
      anchors: [
        { verdict: "met", description: "satisfied" },
        { verdict: "unmet", description: "not satisfied" },
      ],
      evidence: [{ evidenceId: "check-1", role: "primary" }],
    },
  ],
  metadata: [{ criterionId: "c1", role: "decisive", covers: [], appliesTo: ["code"] }],
};
const check = {
  id: "test",
  version: "1",
  environmentIdentity: "env",
  executable: "node",
  args: ["test.js"],
  cwd: ".",
  readPaths: ["."],
  timeoutMs: 1000,
  maxOutputBytes: 1000,
};
function input(sandbox: SandboxPort): EvidenceReviewInput {
  return {
    root: "/independent",
    candidateIdentity: "sha256:candidate",
    checks: [check],
    sandbox,
    signal: new AbortController().signal,
    authorize: () => {},
    review: {
      input: { definition, method: { kind: "program", checker: { id: "checker", version: "1" } } },
      ports: {
        checker: ({ evidence }) => ({
          verdicts: [
            {
              schema: "lorelum.judge.verdict/v1",
              criterionId: "c1",
              verdict: "met",
              evidenceIds: [evidence[0]!.id],
            },
          ],
        }),
      },
    },
  };
}

describe("independent evidence review", () => {
  test("rejects unknown check fields before any authorization or sandbox call", async () => {
    let calls = 0;
    const options = input({
      async run() {
        calls++;
        throw new Error("must not run");
      },
    });
    const malicious = { ...check, candidateIdentity: "sha256:forged", root: "/forged" };
    await expect(
      runEvidenceReview({
        ...options,
        checks: [malicious],
        authorize() {
          calls++;
        },
      }),
    ).rejects.toThrow("unknown approved check fields");
    expect(calls).toBe(0);
    const symbolField = { ...check, [Symbol("unexpected")]: true };
    await expect(runEvidenceReview({ ...options, checks: [symbolField] })).rejects.toThrow(
      "unknown approved check fields",
    );
    const getter = {
      ...check,
      get executable() {
        return "node";
      },
    };
    await expect(runEvidenceReview({ ...options, checks: [getter] })).rejects.toThrow(
      "unknown approved check fields",
    );
  });
  test("retains the candidate and approved command snapshot across asynchronous authorization", async () => {
    let material = "";
    const mutableCheck = { ...check, args: [...check.args], readPaths: [...check.readPaths] };
    const sandbox: SandboxPort = {
      async run(request) {
        expect(request.root).toBe("/independent");
        expect(request.args).toEqual(["test.js"]);
        expect(request.readPaths).toEqual(["."]);
        return { status: "completed", exitCode: 0, stdout: "actual", stderr: "" };
      },
    };
    const options = input(sandbox);
    const mutable = {
      ...options,
      checks: [mutableCheck],
      authorize(stage: string) {
        if (stage === "before_check") {
          mutable.candidateIdentity = "sha256:forged";
          mutable.root = "/forged";
          mutableCheck.args[0] = "forged.js";
          mutableCheck.readPaths[0] = "forged";
        }
      },
      review: {
        ...options.review,
        ports: {
          checker: ({ evidence }: ProgramCheckerInput) => {
            material = evidence[0]!.text!;
            return {
              verdicts: [
                {
                  schema: "lorelum.judge.verdict/v1",
                  criterionId: "c1",
                  verdict: "met",
                  evidenceIds: ["check-1"],
                },
              ],
            };
          },
        },
      },
    };
    const result = await runEvidenceReview(mutable);
    const recorded = JSON.parse(material);
    expect(recorded.candidateIdentity).toBe("sha256:candidate");
    expect(recorded.args).toEqual(["test.js"]);
    expect(recorded.readPaths).toEqual(["."]);
    expect(result.candidateIdentity).toBe("sha256:candidate");
  });
  test("passes actual output and candidate identity to the real judge", async () => {
    let seen = "";
    const sandbox: SandboxPort = {
      async run(request) {
        expect(request.root).toBe("/independent");
        expect(request.readPaths).toEqual(["."]);
        expect(request.writablePaths).toEqual([]);
        expect(request.args).toEqual(["test.js"]);
        return { status: "completed", exitCode: 0, stdout: "actual", stderr: "" };
      },
    };
    const options = input(sandbox);
    const result = await runEvidenceReview({
      ...options,
      review: {
        ...options.review,
        ports: {
          checker: ({ evidence }) => {
            seen = evidence[0]!.text!;
            return {
              verdicts: [
                {
                  schema: "lorelum.judge.verdict/v1",
                  criterionId: "c1",
                  verdict: "met",
                  evidenceIds: ["check-1"],
                },
              ],
            };
          },
        },
      },
    });
    expect(seen).toContain("actual");
    expect(seen).toContain("sha256:candidate");
    expect(result.review?.ok).toBe(true);
    expect(result.checks[0]?.status).toBe("passed");
    expect(result.usage).toEqual({ commands: 1, outputBytes: 6 });
    expect(result.enforcement).toBe("unknown");
    expect(composeEvidenceReport({ diff: "actual diff" }, result).quality).toBe("unknown");
  });
  test("uses the real gate and does not invent calibration", async () => {
    const sandbox: SandboxPort = {
      async run() {
        return { status: "completed", exitCode: 0, stdout: "ok", stderr: "" };
      },
    };
    const options = input(sandbox);
    const first = await runEvidenceReview(options);
    if (!first.review?.ok) throw new Error("review fixture invalid");
    const definitionId = measurementDefinitionIdentityV2(first.review.value.definition);
    const instrumentId = instrumentIdentityV2(first.review.value.instrument);
    if (!definitionId.ok || !instrumentId.ok) throw new Error("identity fixture invalid");
    const policy = {
      schema: "lorelum.judge.gate-policy/v2",
      id: "policy",
      definitionIdentity: definitionId.identity,
      instrumentIdentity: instrumentId.identity,
      scopes: [{ taskClass: "code", evidenceShape: "code", criterionIds: ["c1"] }],
      criteria: [
        {
          criterionId: "c1",
          acceptedVerdicts: ["met"],
          requiredCaseKinds: ["decisive", "equivalent", "anti"],
        },
      ],
      minimumAgreement: 1,
      minimumGroupsPerCaseKind: 1,
      confidenceLevel: 0.95,
      maximumFalseAcceptRate: 0.05,
      maximumFalseRejectRate: 0.1,
      maximumAbstentionRate: 0.2,
      maximumDisagreementRate: 0.2,
      onUncalibrated: "diagnostic",
    };
    const result = await runEvidenceReview({
      ...options,
      review: {
        ...options.review,
        gate: {
          id: "gate",
          taskClass: "code",
          evidenceShape: "code",
          policy,
          now: "2026-10-18T00:00:00.000Z",
        },
      },
    });
    expect(result.gate?.ok).toBe(true);
    if (!result.gate?.ok) return;
    expect(result.gate.value.decision.qualityOutcome).toBe("pass");
    expect(result.gate.value.completeness).toBe("complete");
    expect(result.gate.value.enforcementEligibility).toBe(false);
    expect(result.gate.value.reasons).toContain("calibration_unavailable");
    expect(result.enforcement).toBe("ineligible");
  });
  test("records failure and truncation without treating either as success", async () => {
    let n = 0;
    const sandbox: SandboxPort = {
      async run() {
        return ++n === 1
          ? { status: "completed", exitCode: 1, stdout: "", stderr: "failed" }
          : { status: "truncated", exitCode: null, stdout: "partial", stderr: "" };
      },
    };
    const options = input(sandbox);
    const result = await runEvidenceReview({
      ...options,
      checks: [check, { ...check, id: "other" }],
    });
    expect(result.checks.map((item) => item.status)).toEqual(["failed", "truncated"]);
    expect(result.completeness).toBe("incomplete");
    expect(result.enforcement).toBe("ineligible");
  });
  test("real judge preserves a supported failure alongside unavailable checks", async () => {
    const twoCriteria = {
      ...definition,
      criteria: [
        definition.criteria[0]!,
        {
          ...definition.criteria[0]!,
          id: "c2",
          source: { origin: "contract", ref: "AC-2" },
          evidence: [{ evidenceId: "check-2", role: "primary" }],
        },
      ],
      metadata: [definition.metadata[0]!, { ...definition.metadata[0]!, criterionId: "c2" }],
    };
    let calls = 0;
    let received: ProgramCheckerInput["evidence"] = [];
    const sandbox: SandboxPort = {
      async run() {
        const position = calls++ % 4;
        if (position === 0)
          return { status: "completed", exitCode: 1, stdout: "", stderr: "real failure" };
        if (position === 1)
          return { status: "truncated", exitCode: null, stdout: "partial output", stderr: "" };
        if (position === 2)
          return { status: "timed_out", exitCode: null, stdout: "timed output", stderr: "" };
        throw new Error("sandbox unavailable");
      },
    };
    const options = input(sandbox);
    const checker = ({ evidence }: ProgramCheckerInput) => {
      received = evidence;
      const first = evidence.find((item) => item.id === "check-1");
      const failed = first?.status === "present" && JSON.parse(first.text!).status === "failed";
      return {
        verdicts: failed
          ? [
              {
                schema: "lorelum.judge.verdict/v1",
                criterionId: "c1",
                verdict: "unmet",
                evidenceIds: ["check-1"],
              },
            ]
          : [],
      };
    };
    const review = {
      input: { ...options.review.input, definition: twoCriteria },
      ports: { checker },
    };
    const checks = [
      check,
      { ...check, id: "truncated" },
      { ...check, id: "timeout" },
      { ...check, id: "unavailable" },
    ];
    const first = await runEvidenceReview({ ...options, checks, review });
    if (!first.review?.ok) throw new Error("review fixture invalid");
    const definitionId = measurementDefinitionIdentityV2(first.review.value.definition);
    const instrumentId = instrumentIdentityV2(first.review.value.instrument);
    if (!definitionId.ok || !instrumentId.ok) throw new Error("identity fixture invalid");
    const policy = {
      schema: "lorelum.judge.gate-policy/v2",
      id: "policy",
      definitionIdentity: definitionId.identity,
      instrumentIdentity: instrumentId.identity,
      scopes: [{ taskClass: "code", evidenceShape: "code", criterionIds: ["c1", "c2"] }],
      criteria: ["c1", "c2"].map((criterionId) => ({
        criterionId,
        acceptedVerdicts: ["met"],
        requiredCaseKinds: ["decisive", "equivalent", "anti"],
      })),
      minimumAgreement: 1,
      minimumGroupsPerCaseKind: 1,
      confidenceLevel: 0.95,
      maximumFalseAcceptRate: 0.05,
      maximumFalseRejectRate: 0.1,
      maximumAbstentionRate: 0.2,
      maximumDisagreementRate: 0.2,
      onUncalibrated: "diagnostic",
    };
    const result = await runEvidenceReview({
      ...options,
      checks,
      review: {
        ...review,
        gate: {
          id: "gate",
          taskClass: "code",
          evidenceShape: "code",
          policy,
          now: "2026-10-18T00:00:00.000Z",
        },
      },
    });
    expect(received[0]?.status).toBe("present");
    expect(JSON.parse(received[0]!.text!).stderr).toBe("real failure");
    expect(received.slice(1)).toEqual([
      { id: "check-2", status: "unavailable" },
      { id: "check-3", status: "unavailable" },
      { id: "check-4", status: "unavailable" },
    ]);
    expect(result.checks[1]?.stdout).toBe("partial output");
    expect(result.checks[2]?.stdout).toBe("timed output");
    expect(result.checks[3]?.error).toContain("sandbox unavailable");
    expect(result.review?.ok).toBe(true);
    if (!result.review?.ok) return;
    expect(result.review.value.completeness).toBe("partial");
    expect(result.gate?.ok).toBe(true);
    if (!result.gate?.ok) return;
    expect(result.gate.value.decision.qualityOutcome).toBe("fail");
    expect(result.gate.value.enforcementEligibility).toBe(false);
    expect(result.completeness).toBe("incomplete");
    expect(result.enforcement).toBe("ineligible");
  });
  test("revalidates between checks and does not execute after denial", async () => {
    let calls = 0;
    const sandbox: SandboxPort = {
      async run() {
        calls++;
        return { status: "completed", exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const options = input(sandbox);
    const result = await runEvidenceReview({
      ...options,
      checks: [check, { ...check, id: "other" }],
      authorize(stage) {
        if (stage === "after_check") throw new Error("revoked");
      },
    });
    expect(calls).toBe(1);
    expect(result.checks[1]?.status).toBe("not_started");
    expect(result.stopReason).toContain("revoked");
    expect(result.review).toBeNull();
    expect(result.enforcement).toBe("ineligible");
  });
  test("does not run on cancellation, and does not publish a revoked review", async () => {
    const controller = new AbortController();
    controller.abort();
    const sandbox: SandboxPort = {
      async run() {
        throw new Error("must not run");
      },
    };
    const cancelled = await runEvidenceReview({ ...input(sandbox), signal: controller.signal });
    expect(cancelled.checks[0]?.status).toBe("not_started");
    expect(cancelled.stopReason).toBe("cancelled");
    const ok: SandboxPort = {
      async run() {
        return { status: "completed", exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const revoked = await runEvidenceReview({
      ...input(ok),
      authorize(stage) {
        if (stage === "after_review") throw new Error("revoked");
      },
    });
    expect(revoked.review).toBeNull();
    expect(revoked.gate).toBeNull();
    expect(revoked.enforcement).toBe("ineligible");
  });
});
