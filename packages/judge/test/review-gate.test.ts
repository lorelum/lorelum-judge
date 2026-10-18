import { describe, expect, test } from "bun:test";

import type { InstrumentProfileV2, MeasurementDefinitionV2 } from "@lorelum/judge-protocol";
import {
  instrumentIdentityV2,
  measurementDefinitionIdentityV2,
  validateGatePolicyV2,
} from "@lorelum/judge-protocol";

import {
  evaluateGate,
  evaluateReviewGate,
  executeReview,
  type ProgramChecker,
  review,
} from "../src/index.js";

function definition(roles: readonly ("decisive" | "advisory")[] = ["decisive", "decisive"]) {
  return {
    schema: "lorelum.judge.measurement-definition/v2",
    id: "review",
    criteria: ["c1", "c2"].map((id, index) => ({
      schema: "lorelum.judge.criterion/v1",
      id,
      kind: "contract" as const,
      description: `criterion ${id}`,
      mandatory: true,
      source: { origin: "contract" as const, ref: `AC-${id}` },
      anchors: [
        { verdict: "met" as const, description: "satisfied" },
        { verdict: "unmet" as const, description: "not satisfied" },
      ],
      evidence: [{ evidenceId: `e${index + 1}`, role: "primary" as const }],
    })),
    metadata: ["c1", "c2"].map((id, index) => ({
      criterionId: id,
      role: roles[index] ?? "decisive",
      covers: [],
      appliesTo: ["code"],
    })),
  };
}

const evidence = [
  { id: "e1", status: "present" as const, text: "first material" },
  { id: "e2", status: "present" as const, text: "second material" },
];

function policy(definitionInput: MeasurementDefinitionV2, instrumentInput: InstrumentProfileV2) {
  const definitionId = measurementDefinitionIdentityV2(definitionInput);
  const instrumentId = instrumentIdentityV2(instrumentInput);
  if (!definitionId.ok || !instrumentId.ok) throw new Error("fixture identity failed");
  const result = validateGatePolicyV2({
    schema: "lorelum.judge.gate-policy/v2",
    id: "policy",
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
    scopes: [{ taskClass: "code", evidenceShape: "code", criterionIds: ["c1", "c2"] }],
    criteria: [
      {
        criterionId: "c1",
        acceptedVerdicts: ["met"],
        requiredCaseKinds: ["decisive", "equivalent", "anti"],
      },
      {
        criterionId: "c2",
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
  });
  if (!result.ok) throw new Error("fixture policy invalid");
  return result.value;
}

function met(criterionId: string, evidenceId: string) {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId,
    verdict: "met",
    evidenceIds: [evidenceId],
  };
}

function unmet(criterionId: string, evidenceId: string) {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId,
    verdict: "unmet",
    evidenceIds: [evidenceId],
  };
}

async function executionFor(checker: ProgramChecker, roles?: readonly ("decisive" | "advisory")[]) {
  const result = await executeReview(
    {
      definition: definition(roles),
      evidence,
      method: { kind: "program", checker: { id: "offline", version: "1" } },
    },
    { checker },
  );
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(" "));
  return result.value;
}

describe("evaluateReviewGate", () => {
  test("uncalibrated complete review stays advisory and can pass", async () => {
    const review = await executionFor(() => ({
      verdicts: [met("c1", "e1"), met("c2", "e2")],
    }));
    const result = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: review.execution,
      definition: review.definition,
      instrument: review.instrument,
      policy: policy(review.definition, review.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completeness).toBe("complete");
    expect(result.value.decision.qualityOutcome).toBe("pass");
    expect(result.value.decision.executionMode).toBe("diagnostic");
    expect(result.value.enforcementEligibility).toBe(false);
    expect(result.value.reasons).toContain("calibration_unavailable");
  });

  test("a supported required failure stays visible when another item is unfinished", async () => {
    const review = await executionFor(() => ({ verdicts: [unmet("c1", "e1")] }));
    const result = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: review.execution,
      definition: review.definition,
      instrument: review.instrument,
      policy: policy(review.definition, review.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completeness).toBe("partial");
    expect(result.value.decision.qualityOutcome).toBe("fail");
    expect(result.value.decision.executionMode).toBe("diagnostic");
    const failed = result.value.decision.findings.find((finding) => finding.criterionId === "c1");
    expect(failed?.outcome).toBe("fail");
    const missing = result.value.decision.findings.find((finding) => finding.criterionId === "c2");
    expect(missing?.outcome).toBe("indeterminate");
  });

  test("an advisory mandatory criterion cannot block the gate", async () => {
    const review = await executionFor(
      () => ({ verdicts: [unmet("c1", "e1"), met("c2", "e2")] }),
      ["advisory", "decisive"],
    );
    const result = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: review.execution,
      definition: review.definition,
      instrument: review.instrument,
      policy: policy(review.definition, review.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.qualityOutcome).toBe("pass");
    const advisory = result.value.decision.findings.find((finding) => finding.criterionId === "c1");
    expect(advisory?.outcome).toBe("advisory");
  });

  test("an incomplete review with acceptable required findings cannot pass", async () => {
    const review = await executionFor(
      () => ({ verdicts: [met("c1", "e1")] }),
      ["decisive", "advisory"],
    );
    const result = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: review.execution,
      definition: review.definition,
      instrument: review.instrument,
      policy: policy(review.definition, review.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completeness).toBe("partial");
    expect(result.value.decision.qualityOutcome).toBe("indeterminate");
  });

  test("a cancelled plan keeps its fixed denominator", async () => {
    const controller = new AbortController();
    const secondStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    const checker: ProgramChecker = async () => {
      calls += 1;
      if (calls === 1) return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
      controller.abort();
      secondStarted.resolve();
      await release.promise;
      return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
    };
    const pending = executeReview(
      {
        definition: definition(),
        evidence,
        repetitions: 3,
        signal: controller.signal,
        method: { kind: "program", checker: { id: "offline", version: "1" } },
      },
      { checker },
    );
    await secondStarted.promise;
    release.resolve();
    const review = await pending;
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.value.execution.plannedCount).toBe(3);
    const result = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: review.value.execution,
      definition: review.value.definition,
      instrument: review.value.instrument,
      policy: policy(review.value.definition, review.value.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.completeness).toBe("cancelled");
    expect(result.value.decision.executionMode).toBe("diagnostic");
    expect(result.value.enforcementEligibility).toBe(false);
  });

  test("a hand-built execution whose request or response differs is refused enforcement", async () => {
    const model = {
      async generate() {
        return {
          kind: "message" as const,
          content: JSON.stringify({
            verdicts: [met("c1", "e1"), met("c2", "e2")],
          }),
          metadata: { model: "model-1", finishReason: "stop" },
        };
      },
    };
    const review = await executeReview(
      {
        definition: definition(),
        evidence,
        method: {
          kind: "llm",
          provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
          endpointIdentity: `sha256:${"a".repeat(64)}`,
          model: { provider: "mock", name: "model-1" },
          decoding: { temperature: 0 },
        },
      },
      { model },
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;

    const requestMismatch = structuredClone(review.value.execution);
    const requestAttempt = requestMismatch.attempts[0];
    if (requestAttempt?.llm !== undefined) {
      requestAttempt.llm.request.model = "other-model";
    }
    const requestResult = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: requestMismatch,
      definition: review.value.definition,
      instrument: review.value.instrument,
      policy: policy(review.value.definition, review.value.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(requestResult.ok).toBe(true);
    if (requestResult.ok) {
      expect(requestResult.value.reasons).toContain("request_mismatch");
      expect(requestResult.value.enforcementEligibility).toBe(false);
    }

    const responseConflict = structuredClone(review.value.execution);
    const responseAttempt = responseConflict.attempts[0];
    if (responseAttempt?.llm?.response !== undefined) {
      responseAttempt.llm.response.model = "other-model";
    }
    const responseResult = evaluateReviewGate({
      id: "decision",
      taskClass: "code",
      evidenceShape: "code",
      execution: responseConflict,
      definition: review.value.definition,
      instrument: review.value.instrument,
      policy: policy(review.value.definition, review.value.instrument),
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(responseResult.ok).toBe(true);
    if (responseResult.ok) {
      expect(responseResult.value.reasons).toContain("response_model_conflict");
      expect(responseResult.value.enforcementEligibility).toBe(false);
    }
  });
});

describe("direct gate evidence binding", () => {
  test("a v2 run is rejected when its evidence bundle differs", async () => {
    const reviewed = await executionFor(() => ({
      verdicts: [met("c1", "e1"), met("c2", "e2")],
    }));
    const attempt = reviewed.execution.attempts[0];
    if (attempt?.run === undefined || attempt.evidenceBundle === undefined) {
      throw new Error("fixture attempt incomplete");
    }
    const bundle = structuredClone(attempt.evidenceBundle);
    const first = bundle.items[0];
    if (first === undefined) throw new Error("fixture bundle empty");
    first.contentIdentity = `sha256:${"9".repeat(64)}`;
    const result = evaluateGate({
      id: "decision",
      definition: reviewed.definition,
      instrument: reviewed.instrument,
      policy: policy(reviewed.definition, reviewed.instrument),
      taskClass: "code",
      evidenceShape: "code",
      observations: [
        {
          status: "completed",
          id: attempt.id,
          run: attempt.run,
          evidenceBundle: bundle,
        },
      ],
      now: "2026-10-18T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.qualityOutcome).toBe("indeterminate");
    expect(result.value.findings.some((finding) => finding.reason === "unsupported_evidence")).toBe(
      true,
    );
  });
});

describe("one-call review", () => {
  test("rejects an invalid gate policy before calling the checker", async () => {
    let calls = 0;
    const result = await review(
      {
        definition: definition(),
        evidence,
        method: { kind: "program", checker: { id: "offline", version: "1" } },
        gate: { policy: { schema: "not-a-policy" } },
      },
      {
        checker: () => {
          calls += 1;
          return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("rejects a semantically invalid policy before calling the checker", async () => {
    const reviewed = await executionFor(() => ({
      verdicts: [met("c1", "e1"), met("c2", "e2")],
    }));
    const base = policy(reviewed.definition, reviewed.instrument);
    const firstRule = base.criteria[0];
    if (firstRule === undefined) throw new Error("fixture policy empty");
    const invalid = {
      ...base,
      criteria: [{ ...firstRule, acceptedVerdicts: ["unmet"] }, ...base.criteria.slice(1)],
    };
    let calls = 0;
    const result = await review(
      {
        definition: reviewed.definition,
        evidence,
        method: { kind: "program", checker: { id: "offline", version: "1" } },
        gate: { policy: invalid, taskClass: "code", evidenceShape: "code" },
      },
      {
        checker: () => {
          calls += 1;
          return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("rejects instrument and scope mismatches before calling the checker", async () => {
    const reviewed = await executionFor(() => ({
      verdicts: [met("c1", "e1"), met("c2", "e2")],
    }));
    const base = policy(reviewed.definition, reviewed.instrument);
    const firstScope = base.scopes[0];
    if (firstScope === undefined) throw new Error("fixture scope missing");
    const cases = [
      { ...base, instrumentIdentity: `sha256:${"f".repeat(64)}` },
      {
        ...base,
        scopes: [{ ...firstScope, criterionIds: ["c1"] }],
      },
    ];
    for (const candidate of cases) {
      let calls = 0;
      const result = await review(
        {
          definition: reviewed.definition,
          evidence,
          method: { kind: "program", checker: { id: "offline", version: "1" } },
          gate: { policy: candidate, taskClass: "code", evidenceShape: "code" },
        },
        {
          checker: () => {
            calls += 1;
            return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
          },
        },
      );
      expect(result.ok).toBe(false);
      expect(calls).toBe(0);
    }
  });

  test("returns findings, completion and advisory gate information", async () => {
    let calls = 0;
    const result = await review(
      {
        definition: definition(),
        evidence,
        method: { kind: "program", checker: { id: "offline", version: "1" } },
        gate: { taskClass: "code", evidenceShape: "code" },
      },
      {
        checker: () => {
          calls += 1;
          return { verdicts: [met("c1", "e1"), met("c2", "e2")] };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(1);
    expect(result.value.review.completeness).toBe("complete");
    expect(result.value.gate.decision.qualityOutcome).toBe("pass");
    expect(result.value.gate.decision.executionMode).toBe("diagnostic");
    expect(result.value.gate.enforcementEligibility).toBe(false);
    expect(result.value.gate.explanation.length).toBeGreaterThan(0);
  });
});
