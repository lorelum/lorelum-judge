import {
  type EvidenceBundle,
  evidenceBundleIdentity,
  identityOf,
  instrumentIdentityV2,
  measurementDefinitionIdentityV2,
  projectCodeSource,
  type ReviewPlan,
  reviewPlanIdentity,
  type SourceSnapshot,
  snapshot,
  sourceSnapshotIdentity,
  validateMeasurementDefinitionV2,
  validateReviewPlan,
  validateSourceSnapshot,
} from "@lorelum/judge-protocol";
import type { RuntimeMessage } from "@lorelum/judge-runtime";

import { buildManifest, validateMaterials } from "../evidence.js";
import { compilePrompt } from "../prompt-compiler.js";
import { buildReviewPrompt } from "../review-prompt.js";
import { isRecord } from "../type-guards.js";
import { buildCodeReviewPrompt } from "./code-prompt.js";

export { generationFor, instrumentFor, llmRequestFacts, validateMethod } from "./method.js";

import { instrumentFor, validateMethod } from "./method.js";
import { type PrepareReviewResult, REVIEW_INPUT_SCHEMA } from "./types.js";
import { validation } from "./validation.js";

function prepare(
  input: unknown,
  checkerPort: unknown,
  modelPort: unknown,
  code?: { plan: ReviewPlan; source: SourceSnapshot; followUpReferences?: readonly string[] },
): PrepareReviewResult {
  if (!isRecord(input)) {
    return { ok: false, issues: [validation("$", "input must be an object")] };
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    return { ok: false, issues: [validation("$.signal", "signal must be an AbortSignal")] };
  }
  if (input.id !== undefined && (typeof input.id !== "string" || input.id.length === 0)) {
    return { ok: false, issues: [validation("$.id", "id must be a non-empty string")] };
  }
  const copied = snapshot({
    definition: input.definition,
    evidence: input.evidence,
    method: input.method,
    ...(input.repetitions === undefined ? {} : { repetitions: input.repetitions }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
  if (!isRecord(copied)) {
    return { ok: false, issues: [validation("$", "input must be an object")] };
  }
  const definition = validateMeasurementDefinitionV2(copied.definition);
  if (!definition.ok) {
    return {
      ok: false,
      issues: definition.issues.map((issue) => ({
        ...issue,
        path: `$.definition${issue.path.slice(1)}`,
      })),
    };
  }
  if (!Array.isArray(copied.evidence)) {
    return { ok: false, issues: [validation("$.evidence", "evidence must be an array")] };
  }
  const materialResult = validateMaterials(copied.evidence);
  if (!materialResult.ok) {
    return { ok: false, issues: materialResult.issues };
  }
  const materials = materialResult.value;
  const methodCheck = validateMethod(copied.method);
  if (!methodCheck.ok) {
    return { ok: false, issues: methodCheck.issues };
  }
  const method = methodCheck.value;
  const repetitions = copied.repetitions ?? 1;
  if (typeof repetitions !== "number" || !Number.isSafeInteger(repetitions) || repetitions < 1) {
    return {
      ok: false,
      issues: [validation("$.repetitions", "repetitions must be a positive integer")],
    };
  }
  const timeoutMs = copied.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
  ) {
    return {
      ok: false,
      issues: [validation("$.timeoutMs", "timeoutMs must be a positive integer")],
    };
  }
  if (method.kind === "program" && checkerPort === undefined) {
    return { ok: false, issues: [validation("$", "the program method needs a checker port")] };
  }
  if (method.kind === "llm" && modelPort === undefined) {
    return { ok: false, issues: [validation("$", "the llm method needs a model port")] };
  }

  let manifest: EvidenceBundle;
  let promptIdentity: string | undefined;
  let messages: readonly RuntimeMessage[] | undefined;
  let renderIdentity: string | undefined;
  if (method.kind === "llm") {
    const compiled = compilePrompt({
      prompt:
        code === undefined
          ? buildReviewPrompt(definition.value)
          : buildCodeReviewPrompt(
              code.plan,
              code.source,
              code.followUpReferences ??
                code.source.items.filter((item) => item.role === "opinion").map((item) => item.id),
            ),
      evidence: materials,
    });
    if (!compiled.ok) {
      return {
        ok: false,
        issues: compiled.issues.map((issue) => ({
          path: `$.${issue.path.slice(2)}`,
          code: "schema",
          message: `${issue.code}: ${issue.message}`,
        })),
      };
    }
    manifest = compiled.value.manifest;
    promptIdentity = compiled.value.promptIdentity;
    renderIdentity = compiled.value.renderIdentity;
    messages = compiled.value.messages;
  } else {
    const built = buildManifest(materials);
    if (!built.ok) {
      return { ok: false, issues: built.issues };
    }
    manifest = built.value.manifest;
  }

  const instrument = instrumentFor(method, repetitions, promptIdentity);
  if (code !== undefined) {
    instrument.method.parserVersion = "lorelum.judge.review-parser/v2";
    if (instrument.method.kind === "llm")
      instrument.method.compilerVersion = "lorelum.judge.review-compiler/v2";
    else {
      instrument.method.implementationVersion = "lorelum.judge.review-execution/v2";
      instrument.method.resultProtocolVersion = "lorelum.judge.review-result/v2";
    }
  }
  if (code !== undefined) {
    const planned = measurementDefinitionIdentityV2(code.plan.definition);
    const actual = measurementDefinitionIdentityV2(definition.value);
    if (!planned.ok || !actual.ok || planned.identity !== actual.identity)
      return {
        ok: false,
        issues: [validation("$.definition", "definition differs from the review plan")],
      };
    for (const item of code.source.items) {
      const material = materials.find((entry) => entry.id === item.id);
      const expected = projectCodeSource(item);
      const normalized = validateMaterials([{ id: item.id, status: "present", text: expected }]);
      if (!normalized.ok || material === undefined || material.text !== normalized.value[0]?.text)
        return {
          ok: false,
          issues: [
            validation("$.evidence", `source ${item.id} must use its original numbered lines`),
          ],
        };
    }
    if (materials.some((material) => !code.source.items.some((item) => item.id === material.id)))
      return {
        ok: false,
        issues: [validation("$.evidence", "evidence must belong to the source snapshot")],
      };
  }
  const definitionId = measurementDefinitionIdentityV2(definition.value);
  const instrumentId = instrumentIdentityV2(instrument);
  if (!definitionId.ok || !instrumentId.ok) {
    return {
      ok: false,
      issues: [
        ...(!definitionId.ok ? definitionId.issues : []),
        ...(!instrumentId.ok ? instrumentId.issues : []),
      ],
    };
  }
  const evidenceId = evidenceBundleIdentity(manifest);
  if (!evidenceId.ok) {
    return { ok: false, issues: evidenceId.issues };
  }
  const inputIdentity = identityOf(REVIEW_INPUT_SCHEMA, {
    definition: definition.value,
    evidence: materials,
    method,
    repetitions,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(code === undefined ? {} : { plan: code.plan, source: code.source }),
  });
  if (!inputIdentity.ok) {
    return {
      ok: false,
      issues: [
        validation(inputIdentity.error.path, `input identity: ${inputIdentity.error.reason}`),
      ],
    };
  }

  return {
    ok: true,
    value: {
      definition: definition.value,
      instrument,
      manifest,
      materials,
      method,
      repetitions,
      timeoutMs,
      promptIdentity,
      messages,
      renderIdentity,
      inputIdentity: inputIdentity.identity,
      definitionIdentity: definitionId.identity,
      instrumentIdentity: instrumentId.identity,
      evidenceIdentity: evidenceId.identity,
      ...(code === undefined
        ? {}
        : {
            codeReview: {
              definition: definition.value,
              source: code.source,
              manifest,
              plan: code.plan,
              projectionMode: method.kind === "llm" ? "escaped" : "plain",
              ...(code.followUpReferences === undefined
                ? {}
                : { followUpReferences: code.followUpReferences }),
            },
          }),
      ...(copied.id !== undefined && typeof copied.id === "string" ? { id: copied.id } : {}),
    },
  };
}

export function prepareReview(
  input: unknown,
  ports: { readonly checker?: unknown; readonly model?: unknown },
  code?: { plan: ReviewPlan; source: SourceSnapshot; followUpReferences?: readonly string[] },
): PrepareReviewResult {
  try {
    if (code !== undefined) {
      const source = validateSourceSnapshot(code.source);
      if (!source.ok) return source;
      const plan = validateReviewPlan(code.plan, source.value);
      if (!plan.ok) return plan;
      const sourceId = sourceSnapshotIdentity(source.value);
      const planId = reviewPlanIdentity(plan.value);
      if (!sourceId.ok) return sourceId;
      if (!planId.ok) return planId;
      return prepare(input, ports.checker, ports.model, {
        ...code,
        source: source.value,
        plan: plan.value,
      });
    }
    return prepare(input, ports.checker, ports.model);
  } catch (error) {
    return {
      ok: false,
      issues: [
        validation(
          "$",
          `review input could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
      ],
    };
  }
}
