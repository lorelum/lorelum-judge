import {
  type EvidenceBundle,
  evidenceBundleIdentity,
  identityOf,
  instrumentIdentityV2,
  measurementDefinitionIdentityV2,
  snapshot,
  validateMeasurementDefinitionV2,
} from "@lorelum/judge-protocol";
import type { RuntimeMessage } from "@lorelum/judge-runtime";

import { buildManifest, validateMaterials } from "../evidence.js";
import { compilePrompt } from "../prompt-compiler.js";
import { buildReviewPrompt } from "../review-prompt.js";
import { isRecord } from "../type-guards.js";

export { generationFor, instrumentFor, llmRequestFacts, validateMethod } from "./method.js";

import { instrumentFor, validateMethod } from "./method.js";
import { type PrepareReviewResult, REVIEW_INPUT_SCHEMA } from "./types.js";
import { validation } from "./validation.js";

function prepare(input: unknown, checkerPort: unknown, modelPort: unknown): PrepareReviewResult {
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
      prompt: buildReviewPrompt(definition.value),
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
      ...(copied.id !== undefined && typeof copied.id === "string" ? { id: copied.id } : {}),
    },
  };
}

export function prepareReview(
  input: unknown,
  ports: { readonly checker?: unknown; readonly model?: unknown },
): PrepareReviewResult {
  try {
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
