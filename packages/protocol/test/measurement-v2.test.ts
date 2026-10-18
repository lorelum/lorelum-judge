import { describe, expect, test } from "bun:test";

import {
  anyDefinitionIdentity,
  anyInstrumentIdentity,
  evidenceBundleIdentity,
  frozenRubricToDefinition,
  instrumentIdentityV2,
  isRequiredCriterion,
  measurementDefinitionIdentityV2,
  migrateDefinitionV1,
  requiredCriterionIds,
  validateAnyRun,
  validateInstrumentV2,
  validateMeasurementDefinitionV2,
  validateMeasurementRunV2,
  validateReviewExecution,
} from "../src/index.js";

const hex = (character: string) => `sha256:${character.repeat(64)}`;

function criterion(id: string, evidenceId: string, mandatory = true): Record<string, unknown> {
  return {
    schema: "lorelum.judge.criterion/v1",
    id,
    kind: "contract",
    description: `criterion ${id}`,
    mandatory,
    source: { origin: "contract", ref: `AC-${id}` },
    anchors: [
      { verdict: "met", description: "satisfied" },
      { verdict: "unmet", description: "not satisfied" },
    ],
    evidence: [{ evidenceId, role: "primary" }],
  };
}

function definitionV2(role = "decisive"): Record<string, unknown> {
  return {
    schema: "lorelum.judge.measurement-definition/v2",
    id: "review",
    criteria: [criterion("c1", "e1"), criterion("c2", "e2")],
    metadata: [
      { criterionId: "c1", role, covers: ["AC-c1"], appliesTo: ["code"] },
      { criterionId: "c2", role: "decisive", covers: [], appliesTo: ["code"] },
    ],
  };
}

function programInstrument(): Record<string, unknown> {
  return {
    schema: "lorelum.judge.instrument-profile/v2",
    method: {
      kind: "program",
      checker: { id: "lint", version: "1" },
      implementationVersion: "review/v1",
      resultProtocolVersion: "result/v1",
      parserVersion: "parser/v1",
      runtime: { name: "judge", version: "0.0.0" },
      repetitions: 1,
    },
  };
}

function llmInstrument(endpoint = hex("a"), repetitions = 1): Record<string, unknown> {
  return {
    schema: "lorelum.judge.instrument-profile/v2",
    method: {
      kind: "llm",
      provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
      endpointIdentity: endpoint,
      model: { provider: "mock", name: "model-1" },
      decoding: { temperature: 0 },
      promptIdentity: hex("b"),
      compilerVersion: "compiler/v1",
      renderVersion: "render/v1",
      parserVersion: "parser/v1",
      runtime: { name: "judge", version: "0.0.0" },
      repetitions,
    },
  };
}

function bundle(): Record<string, unknown> {
  return {
    schema: "lorelum.judge.evidence-bundle/v1",
    items: [
      {
        schema: "lorelum.judge.evidence-item/v1",
        id: "e1",
        status: "present",
        contentIdentity: hex("1"),
        render: { state: "rendered", originalLength: 4, renderedLength: 4 },
      },
      {
        schema: "lorelum.judge.evidence-item/v1",
        id: "e2",
        status: "present",
        contentIdentity: hex("2"),
        render: { state: "rendered", originalLength: 4, renderedLength: 4 },
      },
    ],
  };
}

function verdicts(): Record<string, unknown>[] {
  return [
    {
      schema: "lorelum.judge.verdict/v1",
      criterionId: "c1",
      verdict: "met",
      evidenceIds: ["e1"],
    },
    {
      schema: "lorelum.judge.verdict/v1",
      criterionId: "c2",
      verdict: "met",
      evidenceIds: ["e2"],
    },
  ];
}

function identities(definition: Record<string, unknown>, instrument: Record<string, unknown>) {
  const definitionId = measurementDefinitionIdentityV2(definition);
  const instrumentId = instrumentIdentityV2(instrument);
  const evidenceId = evidenceBundleIdentity(bundle());
  if (!definitionId.ok || !instrumentId.ok || !evidenceId.ok) {
    throw new Error("fixture identity failed");
  }
  return {
    definitionId: definitionId.identity,
    instrumentId: instrumentId.identity,
    evidenceId: evidenceId.identity,
  };
}

function runV2(): Record<string, unknown> {
  const definition = definitionV2();
  const instrument = llmInstrument();
  const ids = identities(definition, instrument);
  return {
    schema: "lorelum.judge.measurement-run/v2",
    id: "run-1",
    definitionIdentity: ids.definitionId,
    instrumentIdentity: ids.instrumentId,
    instrumentSource: "declared",
    executionId: "exec-1",
    evidenceIdentity: ids.evidenceId,
    renderIdentity: hex("c"),
    verdicts: verdicts(),
  };
}

function execution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const definition = definitionV2();
  const instrument = llmInstrument();
  const ids = identities(definition, instrument);
  return {
    schema: "lorelum.judge.review-execution/v1",
    id: "exec-1",
    inputIdentity: hex("d"),
    definitionIdentity: ids.definitionId,
    instrumentIdentity: ids.instrumentId,
    plannedCount: 1,
    attempts: [
      {
        id: "attempt-1",
        index: 0,
        status: "completed",
        startedAt: "2026-10-18T00:00:00.000Z",
        finishedAt: "2026-10-18T00:00:01.000Z",
        evidenceBundle: bundle(),
        run: runV2(),
        llm: {
          request: {
            model: "model-1",
            modelProvider: "mock",
            endpointIdentity: hex("a"),
            parameters: { temperature: 0 },
            promptIdentity: hex("b"),
            renderIdentity: hex("c"),
          },
          response: { model: "model-1", finishReason: "stop" },
          unknowns: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("measurement definition v2", () => {
  test("keeps criterion content and per-item metadata", () => {
    const result = validateMeasurementDefinitionV2(definitionV2());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.criteria[0]?.mandatory).toBe(true);
      expect(result.value.metadata[0]?.role).toBe("decisive");
      expect(requiredCriterionIds(result.value)).toEqual(["c1", "c2"]);
    }
  });

  test("an advisory mandatory criterion does not participate", () => {
    const result = validateMeasurementDefinitionV2(definitionV2("advisory"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.criteria[0]?.mandatory).toBe(true);
      expect(isRequiredCriterion(result.value, "c1")).toBe(false);
      expect(requiredCriterionIds(result.value)).toEqual(["c2"]);
    }
  });

  test("metadata must match criteria one to one", () => {
    const candidate = definitionV2();
    const metadata = candidate.metadata;
    if (!Array.isArray(metadata)) throw new Error("fixture");
    candidate.metadata = metadata.slice(0, 1);
    const missing = validateMeasurementDefinitionV2(candidate);
    expect(missing.ok).toBe(false);

    candidate.metadata = [
      { criterionId: "c1", role: "decisive" },
      { criterionId: "c1", role: "advisory" },
    ];
    const duplicate = validateMeasurementDefinitionV2(candidate);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.issues.map((issue) => issue.code)).toContain("duplicate_criterion");
    }
  });

  test("identity covers role, covers and appliesTo", () => {
    const base = definitionV2();
    const changed = definitionV2();
    const metadata = changed.metadata;
    if (!Array.isArray(metadata) || typeof metadata[0] !== "object" || metadata[0] === null) {
      throw new Error("fixture");
    }
    Object.assign(metadata[0], { role: "advisory" });
    const left = measurementDefinitionIdentityV2(base);
    const right = measurementDefinitionIdentityV2(changed);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok && right.ok) {
      expect(left.identity).not.toBe(right.identity);
    }
  });
});

describe("frozen rubric conversion and migration", () => {
  function rubric(status: "proposal" | "frozen"): Record<string, unknown> {
    return {
      schema: "lorelum.judge.rubric-set/v1",
      id: "rubric-1",
      status,
      contractIdentity: hex("e"),
      entries: [
        {
          criterion: criterion("c1", "e1"),
          covers: ["AC-1"],
          appliesTo: ["code"],
          role: "advisory",
        },
      ],
    };
  }

  test("retains source, covers and role without rewriting mandatory", () => {
    const result = frozenRubricToDefinition(rubric("frozen"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.criteria[0]?.mandatory).toBe(true);
      expect(result.value.metadata[0]).toEqual({
        criterionId: "c1",
        role: "advisory",
        covers: ["AC-1"],
        appliesTo: ["code"],
      });
      expect(result.value.provenance?.contractIdentity).toBe(hex("e"));
      expect(result.value.provenance?.rubricIdentity).toMatch(/^sha256:/);
    }
  });

  test("refuses a proposal", () => {
    const result = frozenRubricToDefinition(rubric("proposal"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.message).join(" ")).toContain("frozen");
    }
  });

  test("v1 migration records its source and changes identity", () => {
    const v1 = {
      schema: "lorelum.judge.measurement-definition/v1",
      id: "legacy",
      criteria: [criterion("c1", "e1")],
    };
    const migrated = migrateDefinitionV1(v1);
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.value.metadata[0]?.role).toBe("decisive");
      expect(migrated.value.provenance?.migratedFrom).toBe(
        "lorelum.judge.measurement-definition/v1",
      );
      const oldIdentity = anyDefinitionIdentity(v1);
      const newIdentity = measurementDefinitionIdentityV2(migrated.value);
      expect(oldIdentity.ok).toBe(true);
      expect(newIdentity.ok).toBe(true);
      if (oldIdentity.ok && newIdentity.ok) {
        expect(oldIdentity.identity).not.toBe(newIdentity.identity);
      }
    }
  });
});

describe("instrument v2", () => {
  test("program method has no model fields", () => {
    const result = validateInstrumentV2(programInstrument());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method.kind).toBe("program");
      expect("model" in result.value.method).toBe(false);
    }
  });

  test("a checker must name a version or content identity", () => {
    const candidate = programInstrument();
    const method = candidate.method;
    if (!method || typeof method !== "object") throw new Error("fixture");
    Object.assign(method, { checker: { id: "lint" } });
    expect(validateInstrumentV2(candidate).ok).toBe(false);
  });

  test("endpoint changes the method identity", () => {
    const left = instrumentIdentityV2(llmInstrument(hex("a")));
    const right = instrumentIdentityV2(llmInstrument(hex("b")));
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok && right.ok) {
      expect(left.identity).not.toBe(right.identity);
    }
  });
});

describe("measurement run v2", () => {
  test("requires exactly one valid verdict per criterion", () => {
    const definition = definitionV2();
    const instrument = llmInstrument();
    expect(validateMeasurementRunV2(definition, instrument, runV2()).ok).toBe(true);

    const missing = runV2();
    missing.verdicts = (missing.verdicts as unknown[]).slice(0, 1);
    const result = validateMeasurementRunV2(definition, instrument, missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("missing_verdict");
    }
  });

  test("program runs have no render identity; llm runs need one", () => {
    const definition = definitionV2();
    const program = programInstrument();
    const ids = identities(definition, program);
    const base = runV2();
    const programRun = {
      ...base,
      instrumentIdentity: ids.instrumentId,
      renderIdentity: hex("c"),
    };
    expect(validateMeasurementRunV2(definition, program, programRun).ok).toBe(false);

    const llm = llmInstrument();
    const llmIds = identities(definition, llm);
    const { renderIdentity: _omitted, ...llmRun } = base;
    expect(
      validateMeasurementRunV2(definition, llm, {
        ...llmRun,
        instrumentIdentity: llmIds.instrumentId,
      }).ok,
    ).toBe(false);
  });

  test("any-run dispatch keeps v1 behavior", () => {
    const v1Definition = {
      schema: "lorelum.judge.measurement-definition/v1",
      id: "m1",
      criteria: [criterion("c1", "e1")],
    };
    const v1Instrument = {
      schema: "lorelum.judge.instrument-profile/v1",
      model: { provider: "p", name: "m" },
      decoding: {},
      promptIdentity: hex("a"),
      runtime: { name: "r", version: "1" },
      repetitions: 1,
    };
    const definitionId = anyDefinitionIdentity(v1Definition);
    const instrumentId = anyInstrumentIdentity(v1Instrument);
    expect(definitionId.ok).toBe(true);
    expect(instrumentId.ok).toBe(true);
    if (!definitionId.ok || !instrumentId.ok) return;
    const result = validateAnyRun(v1Definition, v1Instrument, {
      schema: "lorelum.judge.measurement-run/v1",
      id: "run",
      definitionIdentity: definitionId.identity,
      instrumentIdentity: instrumentId.identity,
      instrumentSource: "declared",
      verdicts: [
        {
          schema: "lorelum.judge.verdict/v1",
          criterionId: "c1",
          verdict: "met",
          evidenceIds: ["e1"],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("review execution v1", () => {
  test("accepts a completed attempt with a complete v2 run", () => {
    const result = validateReviewExecution(execution(), definitionV2(), llmInstrument());
    expect(result.ok).toBe(true);
  });

  test("rejects extra facts on a not_started attempt", () => {
    const candidate = execution();
    candidate.attempts = [
      {
        id: "attempt-1",
        index: 0,
        status: "not_started",
        startedAt: "2026-10-18T00:00:00.000Z",
      },
    ];
    const result = validateReviewExecution(candidate, definitionV2(), llmInstrument());
    expect(result.ok).toBe(false);
  });

  test("rejects partial attempts without issues or with a run", () => {
    const candidate = execution();
    candidate.attempts = [
      {
        id: "attempt-1",
        index: 0,
        status: "partial",
        startedAt: "2026-10-18T00:00:00.000Z",
        finishedAt: "2026-10-18T00:00:01.000Z",
        evidenceBundle: bundle(),
        verdicts: [verdicts()[0]],
        issues: [],
      },
    ];
    expect(validateReviewExecution(candidate, definitionV2(), llmInstrument()).ok).toBe(false);
  });

  test("requires every planned slot to be represented", () => {
    const candidate = execution();
    candidate.plannedCount = 2;
    expect(validateReviewExecution(candidate, definitionV2(), llmInstrument()).ok).toBe(false);
  });

  test("rejects a run from another execution", () => {
    const candidate = execution();
    const run = candidate.attempts;
    if (!Array.isArray(run) || typeof run[0] !== "object" || run[0] === null) {
      throw new Error("fixture");
    }
    // Test fixture mutation: the shape is constructed by `execution()` above.
    const attempt = run[0] as { run?: { executionId?: string } };
    if (attempt.run !== undefined) attempt.run.executionId = "other";
    expect(validateReviewExecution(candidate, definitionV2(), llmInstrument()).ok).toBe(false);
  });
});
