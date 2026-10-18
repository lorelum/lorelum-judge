import { randomUUID } from "node:crypto";

import {
  type EvidenceBundle,
  type EvidenceItem,
  evidenceBundleIdentity,
  type InstrumentProfileV2,
  identityOf,
  instrumentIdentityV2,
  type MeasurementDefinitionV2,
  measurementDefinitionIdentityV2,
  type ReviewAttempt,
  type ReviewExecution,
  type ReviewIssue,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
  type Verdict,
  validateEvidenceBundle,
  validateMeasurementDefinitionV2,
  validateReviewExecution,
  validateVerdictEvidence,
} from "@lorelum/judge-protocol";
import type {
  ModelGenerationConfig,
  ModelPort,
  ModelResponse,
  ModelResponseMetadata,
  RuntimeMessage,
} from "@lorelum/judge-runtime";

import { compilePrompt, type EvidenceMaterial, normalizeText } from "./prompt-compiler.js";
import {
  parseReviewResponse,
  REVIEW_PARSER_VERSION,
  REVIEW_RESULT_PROTOCOL_VERSION,
} from "./review-parser.js";
import { buildReviewPrompt, REVIEW_COMPILER_VERSION } from "./review-prompt.js";
import { isRecord } from "./type-guards.js";

export const REVIEW_EXECUTION_VERSION = "lorelum.judge.review-execution/v1";
const INPUT_SCHEMA = "lorelum.judge.review-input/v1";
const CONTENT_SCHEMA = "lorelum.judge.evidence-content/v1";
const ITEM_SCHEMA = "lorelum.judge.evidence-item/v1";
const BUNDLE_SCHEMA = "lorelum.judge.evidence-bundle/v1";
const ENDPOINT_IDENTITY = /^sha256:[0-9a-f]{64}$/;

export interface ProgramCheckerInput {
  readonly definition: MeasurementDefinitionV2;
  readonly evidence: readonly EvidenceMaterial[];
  readonly signal: AbortSignal;
}

export interface ProgramCheckerOutput {
  readonly verdicts: readonly unknown[];
}

export type ProgramChecker = (
  input: ProgramCheckerInput,
) => ProgramCheckerOutput | Promise<ProgramCheckerOutput>;

export type ReviewMethodInput =
  | {
      readonly kind: "program";
      readonly checker: {
        readonly id: string;
        readonly version?: string;
        readonly contentIdentity?: string;
      };
    }
  | {
      readonly kind: "llm";
      readonly provider: {
        readonly protocol: string;
        readonly adapterVersion: string;
      };
      readonly endpointIdentity: string;
      readonly model: {
        readonly provider: string;
        readonly name: string;
        readonly version?: string;
      };
      readonly decoding?: {
        readonly temperature?: number;
        readonly topP?: number;
        readonly maxTokens?: number;
        readonly seed?: number;
      };
    };

export interface ExecuteReviewInput {
  readonly id?: string;
  readonly definition: unknown;
  readonly evidence: readonly EvidenceMaterial[];
  readonly method: ReviewMethodInput;
  /** Explicit only. Ordinary review runs once. */
  readonly repetitions?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ReviewPorts {
  readonly model?: ModelPort;
  readonly checker?: ProgramChecker;
  readonly clock?: { now(): Date };
  readonly nextId?: (prefix: string) => string;
}

export interface ReviewFinding {
  readonly criterionId: string;
  readonly role: "decisive" | "advisory";
  readonly required: boolean;
  readonly status: "assessed" | "missing" | "invalid";
  readonly verdict?: Verdict;
  readonly disagreement: boolean;
  readonly issues: readonly ReviewIssue[];
}

export type ReviewCompleteness = "complete" | "partial" | "failed" | "cancelled" | "not_started";

export interface ExecuteReviewValue {
  readonly definition: MeasurementDefinitionV2;
  readonly instrument: InstrumentProfileV2;
  readonly execution: ReviewExecution;
  readonly findings: readonly ReviewFinding[];
  readonly completeness: ReviewCompleteness;
}

export type ExecuteReviewResult =
  | { readonly ok: true; readonly value: ExecuteReviewValue }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface PreparedReview {
  readonly definition: MeasurementDefinitionV2;
  readonly instrument: InstrumentProfileV2;
  readonly manifest: EvidenceBundle;
  readonly materials: readonly EvidenceMaterial[];
  readonly method: ReviewMethodInput;
  readonly repetitions: number;
  readonly timeoutMs: number | undefined;
  readonly promptIdentity: string | undefined;
  readonly messages: readonly RuntimeMessage[] | undefined;
  readonly renderIdentity: string | undefined;
  readonly inputIdentity: string;
  readonly definitionIdentity: string;
  readonly instrumentIdentity: string;
  readonly evidenceIdentity: string;
  readonly id?: string;
}

export type PrepareReviewResult =
  | { readonly ok: true; readonly value: PreparedReview }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

interface Assessed {
  readonly verdicts: readonly Verdict[];
  readonly issues: readonly ReviewIssue[];
}

type ReviewFailure = NonNullable<ReviewAttempt["failure"]>;
type LlmRequestFacts = NonNullable<ReviewAttempt["llm"]>["request"];

interface ResponseFacts {
  readonly content: string;
  readonly metadata: ModelResponseMetadata | undefined;
  readonly invalidMetadata: boolean;
}

function nonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
  );
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeFailureMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "the checker failed";
  return trimmed.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

class ReviewAbortError extends Error {
  constructor() {
    super("review cancelled");
    this.name = "ReviewAbortError";
  }
}

class ReviewTimeoutError extends Error {
  constructor() {
    super("review attempt timed out");
    this.name = "ReviewTimeoutError";
  }
}

function validation(path: string, message: string): ValidationIssue {
  return { path, code: "schema", message };
}

function materialIssues(
  materials: readonly EvidenceMaterial[],
): { readonly materials: EvidenceMaterial[] } | { readonly issues: readonly ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const copied: EvidenceMaterial[] = [];
  for (const [index, material] of materials.entries()) {
    const path = `$.evidence[${index}]`;
    if (typeof material.id !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(material.id)) {
      issues.push(validation(`${path}.id`, "id must match ^[A-Za-z0-9_.:-]+$"));
      continue;
    }
    if (
      material.status !== "present" &&
      material.status !== "no_evidence" &&
      material.status !== "unavailable" &&
      material.status !== "contradiction"
    ) {
      issues.push(validation(`${path}.status`, "unknown evidence status"));
      continue;
    }
    const hasText = material.status === "present" || material.status === "contradiction";
    if (hasText && typeof material.text !== "string") {
      issues.push(validation(`${path}.text`, `status "${material.status}" requires text`));
      continue;
    }
    if (!hasText && material.text !== undefined) {
      issues.push(validation(`${path}.text`, `status "${material.status}" must not carry text`));
      continue;
    }
    copied.push({
      id: material.id,
      status: material.status,
      ...(hasText ? { text: material.text } : {}),
      ...(material.conflictsWith === undefined
        ? {}
        : { conflictsWith: [...material.conflictsWith] }),
    });
  }
  return issues.length === 0 ? { materials: copied } : { issues };
}

function programManifest(
  materials: readonly EvidenceMaterial[],
): { readonly manifest: EvidenceBundle } | { readonly issues: readonly ValidationIssue[] } {
  const items: EvidenceItem[] = [];
  for (const material of materials) {
    if (material.text === undefined) {
      items.push({
        schema: ITEM_SCHEMA,
        id: material.id,
        status: material.status,
        ...(material.conflictsWith === undefined
          ? {}
          : { conflictsWith: [...material.conflictsWith] }),
      });
      continue;
    }
    const raw = normalizeText(material.text);
    const contentIdentity = identityOf(CONTENT_SCHEMA, raw);
    if (!contentIdentity.ok) {
      return {
        issues: [
          validation(
            `$.evidence.${material.id}`,
            `content identity failed: ${contentIdentity.error.reason}`,
          ),
        ],
      };
    }
    const length = Array.from(raw).length;
    items.push({
      schema: ITEM_SCHEMA,
      id: material.id,
      status: material.status,
      contentIdentity: contentIdentity.identity,
      render: { state: "rendered", originalLength: length, renderedLength: length },
      ...(material.conflictsWith === undefined
        ? {}
        : { conflictsWith: [...material.conflictsWith] }),
    });
  }
  const manifest: EvidenceBundle = { schema: BUNDLE_SCHEMA, items };
  const checked = validateEvidenceBundle(manifest);
  return checked.ok ? { manifest: checked.value } : { issues: checked.issues };
}

function assess(
  definition: MeasurementDefinitionV2,
  rawVerdicts: readonly unknown[],
  bundle: EvidenceBundle,
): Assessed {
  const issues: ReviewIssue[] = [];
  const byCriterion = new Map<string, { readonly index: number; readonly entry: unknown }[]>();
  const criteria = new Map(definition.criteria.map((criterion) => [criterion.id, criterion]));
  for (const [index, entry] of rawVerdicts.entries()) {
    if (!isRecord(entry) || typeof entry.criterionId !== "string") {
      issues.push({
        path: `$.verdicts[${index}]`,
        code: "invalid_entry",
        message: "a verdict needs a criterionId",
      });
      continue;
    }
    if (!criteria.has(entry.criterionId)) {
      issues.push({
        path: `$.verdicts[${index}].criterionId`,
        code: "unknown_criterion",
        message: `definition has no criterion "${entry.criterionId}"`,
      });
      continue;
    }
    const list = byCriterion.get(entry.criterionId) ?? [];
    list.push({ index, entry });
    byCriterion.set(entry.criterionId, list);
  }

  const verdicts: Verdict[] = [];
  for (const criterion of definition.criteria) {
    const entries = byCriterion.get(criterion.id) ?? [];
    if (entries.length === 0) {
      issues.push({
        criterionId: criterion.id,
        path: "$.verdicts",
        code: "missing_verdict",
        message: `criterion "${criterion.id}" has no verdict`,
      });
      continue;
    }
    if (entries.length > 1) {
      for (const entry of entries) {
        issues.push({
          criterionId: criterion.id,
          path: `$.verdicts[${entry.index}].criterionId`,
          code: "duplicate_verdict",
          message: `criterion "${criterion.id}" has more than one verdict`,
        });
      }
      continue;
    }
    const only = entries[0];
    if (only === undefined) continue;
    const checked = validateVerdictEvidence(criterion, only.entry, bundle);
    if (!checked.ok) {
      issues.push(
        ...checked.issues.map((issue) => ({
          criterionId: criterion.id,
          path: `$.verdicts[${only.index}]${issue.path.slice(1)}`,
          code: issue.code,
          message: issue.message,
        })),
      );
      continue;
    }
    verdicts.push(checked.value);
  }
  return { verdicts, issues };
}

function readCheckerOutput(raw: unknown): readonly unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.verdicts)) return raw.verdicts;
  return undefined;
}

function providerFailure(error: unknown): {
  readonly code: string;
  readonly category: ReviewFailure["category"];
  readonly status?: number;
} {
  if (error instanceof ReviewTimeoutError) {
    return { code: "timeout", category: "provider" };
  }
  if (isRecord(error) && typeof error.code === "string") {
    const status = typeof error.httpStatus === "number" ? error.httpStatus : undefined;
    return {
      code: error.code,
      category: error.code === "cancelled" ? "execution" : "provider",
      ...(status === undefined ? {} : { status }),
    };
  }
  return { code: "provider_error", category: "provider" };
}

function withAttemptBoundary<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
  abortOnTimeout?: () => void,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ReviewAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = (): void => {
      finish(() => reject(new ReviewAbortError()));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            finish(() => reject(new ReviewTimeoutError()));
            abortOnTimeout?.();
          }, timeoutMs);
    promise.then(
      (value) => {
        finish(() => resolve(value));
      },
      (error: unknown) => {
        finish(() => reject(error));
      },
    );
  });
}

function responseFacts(response: ModelResponse): ResponseFacts | undefined {
  if (response.kind !== "message") return undefined;
  const metadata = response.metadata;
  if (metadata === undefined) {
    return { content: response.content, metadata: undefined, invalidMetadata: false };
  }
  let invalidMetadata = false;
  const provider = nonEmptyString(metadata.provider) ? metadata.provider : undefined;
  if (metadata.provider !== undefined && provider === undefined) invalidMetadata = true;
  const model = nonEmptyString(metadata.model) ? metadata.model : undefined;
  if (metadata.model !== undefined && model === undefined) invalidMetadata = true;
  const responseId = nonEmptyString(metadata.responseId) ? metadata.responseId : undefined;
  if (metadata.responseId !== undefined && responseId === undefined) invalidMetadata = true;
  const finishReason = nonEmptyString(metadata.finishReason) ? metadata.finishReason : undefined;
  if (metadata.finishReason !== undefined && finishReason === undefined) invalidMetadata = true;
  const status = nonEmptyString(metadata.status) ? metadata.status : undefined;
  if (metadata.status !== undefined && status === undefined) invalidMetadata = true;

  let usage: ModelResponseMetadata["usage"];
  if (metadata.usage !== undefined) {
    const promptTokens = tokenCount(metadata.usage.promptTokens);
    const completionTokens = tokenCount(metadata.usage.completionTokens);
    const totalTokens = tokenCount(metadata.usage.totalTokens);
    if (
      (metadata.usage.promptTokens !== undefined && promptTokens === undefined) ||
      (metadata.usage.completionTokens !== undefined && completionTokens === undefined) ||
      (metadata.usage.totalTokens !== undefined && totalTokens === undefined)
    ) {
      invalidMetadata = true;
    }
    if (promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined) {
      usage = {
        ...(promptTokens === undefined ? {} : { promptTokens }),
        ...(completionTokens === undefined ? {} : { completionTokens }),
        ...(totalTokens === undefined ? {} : { totalTokens }),
      };
    }
  }

  return {
    content: response.content,
    invalidMetadata,
    metadata: {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(responseId === undefined ? {} : { responseId }),
      ...(finishReason === undefined ? {} : { finishReason }),
      ...(status === undefined ? {} : { status }),
      ...(usage === undefined ? {} : { usage }),
    },
  };
}

function unknownFacts(
  metadata: ModelResponseMetadata | undefined,
  invalidMetadata = false,
): string[] {
  if (metadata === undefined) return ["response_metadata_missing"];
  return [
    ...(metadata.model === undefined ? ["response_model_unknown"] : []),
    ...(metadata.finishReason === undefined ? ["finish_reason_unknown"] : []),
    ...(metadata.usage === undefined ? ["usage_unknown"] : []),
    ...(invalidMetadata ? ["response_metadata_invalid"] : []),
  ];
}

function aggregateFindings(
  definition: MeasurementDefinitionV2,
  assessments: readonly Assessed[],
): ReviewFinding[] {
  const metadata = new Map(definition.metadata.map((entry) => [entry.criterionId, entry]));
  return definition.criteria.map((criterion) => {
    const verdicts = assessments.flatMap((assessment) =>
      assessment.verdicts.filter((verdict) => verdict.criterionId === criterion.id),
    );
    const issues = assessments.flatMap((assessment) =>
      assessment.issues.filter((issue) => issue.criterionId === criterion.id),
    );
    const verdict = verdicts[0];
    return {
      criterionId: criterion.id,
      disagreement: new Set(verdicts.map((entry) => entry.verdict)).size > 1,
      role: metadata.get(criterion.id)?.role ?? "decisive",
      required: metadata.get(criterion.id)?.role === "decisive" && criterion.mandatory,
      status: verdict !== undefined ? "assessed" : issues.length > 0 ? "invalid" : "missing",
      ...(verdict === undefined ? {} : { verdict }),
      issues,
    };
  });
}

export function reviewCompleteness(execution: ReviewExecution): ReviewCompleteness {
  const statuses = execution.attempts.map((attempt) => attempt.status);
  if (statuses.includes("cancelled")) return "cancelled";
  if (statuses.every((status) => status === "completed")) return "complete";
  if (statuses.every((status) => status === "not_started")) return "not_started";
  if (statuses.every((status) => status === "failed" || status === "not_started")) {
    return "failed";
  }
  return "partial";
}

function validateMethod(
  raw: unknown,
): { readonly method: ReviewMethodInput } | { readonly issues: readonly ValidationIssue[] } {
  if (!isRecord(raw)) {
    return { issues: [validation("$.method", "method must be an object")] };
  }
  if (raw.kind === "program") {
    if (
      !isRecord(raw.checker) ||
      typeof raw.checker.id !== "string" ||
      raw.checker.id.length === 0
    ) {
      return { issues: [validation("$.method.checker.id", "checker id is required")] };
    }
    const version =
      typeof raw.checker.version === "string" && raw.checker.version.length > 0
        ? raw.checker.version
        : undefined;
    const contentIdentity =
      typeof raw.checker.contentIdentity === "string" ? raw.checker.contentIdentity : undefined;
    if (version === undefined && contentIdentity === undefined) {
      return {
        issues: [validation("$.method.checker", "name the checker version or content identity")],
      };
    }
    if (contentIdentity !== undefined && !ENDPOINT_IDENTITY.test(contentIdentity)) {
      return {
        issues: [validation("$.method.checker.contentIdentity", "must be a sha256 identity")],
      };
    }
    return {
      method: {
        kind: "program",
        checker: {
          id: raw.checker.id,
          ...(version === undefined ? {} : { version }),
          ...(contentIdentity === undefined ? {} : { contentIdentity }),
        },
      },
    };
  }
  if (raw.kind === "llm") {
    if (
      !isRecord(raw.provider) ||
      typeof raw.provider.protocol !== "string" ||
      raw.provider.protocol.length === 0 ||
      typeof raw.provider.adapterVersion !== "string" ||
      raw.provider.adapterVersion.length === 0
    ) {
      return {
        issues: [validation("$.method.provider", "protocol and adapterVersion are required")],
      };
    }
    if (typeof raw.endpointIdentity !== "string" || !ENDPOINT_IDENTITY.test(raw.endpointIdentity)) {
      return { issues: [validation("$.method.endpointIdentity", "must be a sha256 identity")] };
    }
    if (
      !isRecord(raw.model) ||
      typeof raw.model.provider !== "string" ||
      raw.model.provider.length === 0 ||
      typeof raw.model.name !== "string" ||
      raw.model.name.length === 0
    ) {
      return { issues: [validation("$.method.model", "model provider and name are required")] };
    }
    let decoding: NonNullable<Extract<ReviewMethodInput, { kind: "llm" }>["decoding"]> = {};
    if (raw.decoding !== undefined) {
      if (!isRecord(raw.decoding)) {
        return { issues: [validation("$.method.decoding", "decoding must be an object")] };
      }
      for (const key of Object.keys(raw.decoding)) {
        if (!["temperature", "topP", "maxTokens", "seed"].includes(key)) {
          return {
            issues: [validation(`$.method.decoding.${key}`, "unsupported decoding parameter")],
          };
        }
      }
      const { temperature, topP, maxTokens, seed } = raw.decoding;
      if (temperature !== undefined && (typeof temperature !== "number" || temperature < 0)) {
        return { issues: [validation("$.method.decoding.temperature", "must be at least 0")] };
      }
      if (topP !== undefined && (typeof topP !== "number" || topP < 0 || topP > 1)) {
        return { issues: [validation("$.method.decoding.topP", "must be between 0 and 1")] };
      }
      if (
        maxTokens !== undefined &&
        (typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens) || maxTokens < 1)
      ) {
        return {
          issues: [validation("$.method.decoding.maxTokens", "must be a positive integer")],
        };
      }
      if (
        seed !== undefined &&
        (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0)
      ) {
        return { issues: [validation("$.method.decoding.seed", "must be a non-negative integer")] };
      }
      decoding = {
        ...(temperature === undefined ? {} : { temperature }),
        ...(topP === undefined ? {} : { topP }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(seed === undefined ? {} : { seed }),
      };
    }
    return {
      method: {
        kind: "llm",
        provider: {
          protocol: raw.provider.protocol,
          adapterVersion: raw.provider.adapterVersion,
        },
        endpointIdentity: raw.endpointIdentity,
        model: {
          provider: raw.model.provider,
          name: raw.model.name,
          ...(typeof raw.model.version === "string" && raw.model.version.length > 0
            ? { version: raw.model.version }
            : {}),
        },
        decoding,
      },
    };
  }
  return { issues: [validation("$.method.kind", "method must be program or llm")] };
}

function instrumentFor(
  method: ReviewMethodInput,
  repetitions: number,
  promptIdentity: string | undefined,
): InstrumentProfileV2 {
  if (method.kind === "program") {
    return {
      schema: "lorelum.judge.instrument-profile/v2",
      method: {
        kind: "program",
        checker: method.checker,
        implementationVersion: REVIEW_EXECUTION_VERSION,
        resultProtocolVersion: REVIEW_RESULT_PROTOCOL_VERSION,
        parserVersion: REVIEW_PARSER_VERSION,
        runtime: { name: "@lorelum/judge", version: "0.0.0" },
        repetitions,
      },
    };
  }
  if (promptIdentity === undefined) {
    throw new Error("an LLM instrument requires a compiled prompt identity");
  }
  return {
    schema: "lorelum.judge.instrument-profile/v2",
    method: {
      kind: "llm",
      provider: method.provider,
      endpointIdentity: method.endpointIdentity,
      model: method.model,
      decoding: method.decoding ?? {},
      promptIdentity,
      compilerVersion: REVIEW_COMPILER_VERSION,
      renderVersion: "lorelum.judge.prompt-render/v2",
      parserVersion: REVIEW_PARSER_VERSION,
      runtime: { name: "@lorelum/judge", version: "0.0.0" },
      repetitions,
    },
  };
}

function llmRequestFacts(
  method: Extract<ReviewMethodInput, { kind: "llm" }>,
  promptIdentity: string | undefined,
  renderIdentity: string | undefined,
  timeoutMs: number | undefined,
): LlmRequestFacts {
  return {
    model: method.model.name,
    modelProvider: method.model.provider,
    endpointIdentity: method.endpointIdentity,
    parameters: method.decoding ?? {},
    ...(renderIdentity === undefined ? {} : { messagesIdentity: renderIdentity }),
    ...(promptIdentity === undefined ? {} : { promptIdentity }),
    ...(renderIdentity === undefined ? {} : { renderIdentity }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function generationFor(method: Extract<ReviewMethodInput, { kind: "llm" }>): ModelGenerationConfig {
  const decoding = method.decoding ?? {};
  return {
    model: method.model.name,
    ...(decoding.temperature === undefined ? {} : { temperature: decoding.temperature }),
    ...(decoding.topP === undefined ? {} : { topP: decoding.topP }),
    ...(decoding.maxTokens === undefined ? {} : { maxTokens: decoding.maxTokens }),
    ...(decoding.seed === undefined ? {} : { seed: decoding.seed }),
  };
}

function prepare(input: unknown, ports: ReviewPorts): PrepareReviewResult {
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
  const materialCheck = materialIssues(copied.evidence);
  if ("issues" in materialCheck) {
    return { ok: false, issues: materialCheck.issues };
  }
  const materials = materialCheck.materials.map((material) =>
    material.text === undefined ? material : { ...material, text: normalizeText(material.text) },
  );
  const methodCheck = validateMethod(copied.method);
  if ("issues" in methodCheck) {
    return { ok: false, issues: methodCheck.issues };
  }
  const method = methodCheck.method;
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
  const checker = ports.checker;
  const modelPort = ports.model;
  if (method.kind === "program" && checker === undefined) {
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
    const built = programManifest(materials);
    if ("issues" in built) {
      return { ok: false, issues: built.issues };
    }
    manifest = built.manifest;
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
  const inputIdentity = identityOf(INPUT_SCHEMA, {
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

export function prepareReview(input: unknown, ports: ReviewPorts): PrepareReviewResult {
  try {
    return prepare(input, ports);
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

async function runPreparedReviewInner(
  prepared: PreparedReview,
  ports: ReviewPorts,
  signal?: AbortSignal,
): Promise<ExecuteReviewResult> {
  const definition = prepared.definition;
  const instrument = prepared.instrument;
  const manifest = prepared.manifest;
  const materials = prepared.materials;
  const method = prepared.method;
  const repetitions = prepared.repetitions;
  const timeoutMs = prepared.timeoutMs;
  const promptIdentity = prepared.promptIdentity;
  const messages = prepared.messages;
  const renderIdentity = prepared.renderIdentity;
  const checker = ports.checker;
  const modelPort = ports.model;

  const nextId = ports.nextId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
  const clock = ports.clock ?? { now: () => new Date() };
  const executionId = prepared.id ?? nextId("review");
  const attempts: ReviewAttempt[] = [];
  const assessments: Assessed[] = [];
  const activeSignal = signal ?? new AbortController().signal;

  for (let index = 0; index < repetitions; index += 1) {
    const id = nextId("attempt");
    if (activeSignal.aborted) {
      attempts.push({ id, index, status: "not_started" });
      continue;
    }
    const startedAt = clock.now().toISOString();
    const attemptController = new AbortController();
    const abortAttempt = () => attemptController.abort();
    activeSignal.addEventListener("abort", abortAttempt, { once: true });
    if (activeSignal.aborted) attemptController.abort();
    try {
      let raw: readonly unknown[] | undefined;
      let responseMetadata: ModelResponseMetadata | undefined;
      let responseMetadataInvalid = false;
      const llmRequest =
        method.kind === "llm"
          ? llmRequestFacts(method, promptIdentity, renderIdentity, timeoutMs)
          : undefined;

      if (method.kind === "program") {
        if (checker === undefined) throw new Error("missing checker port");
        const output = await withAttemptBoundary(
          Promise.resolve(
            checker({
              definition: definition,
              evidence: materials,
              signal: attemptController.signal,
            }),
          ),
          attemptController.signal,
          timeoutMs,
          () => attemptController.abort(),
        );
        raw = readCheckerOutput(output);
        if (raw === undefined) {
          attempts.push({
            id,
            index,
            status: "failed",
            startedAt,
            finishedAt: clock.now().toISOString(),
            evidenceBundle: manifest,
            failure: {
              category: "execution",
              code: "invalid_checker_output",
              message: "the checker did not return a verdict list",
            },
          });
          continue;
        }
      } else {
        if (modelPort === undefined) throw new Error("missing model port");
        const generation = generationFor(method);
        const response = await withAttemptBoundary(
          modelPort.generate({
            runId: executionId,
            stepIndex: index,
            messages: messages ?? [],
            tools: [],
            signal: attemptController.signal,
            config: generation,
          }),
          attemptController.signal,
          timeoutMs,
          () => attemptController.abort(),
        );
        const facts = responseFacts(response);
        if (facts === undefined) {
          attempts.push({
            id,
            index,
            status: "failed",
            startedAt,
            finishedAt: clock.now().toISOString(),
            evidenceBundle: manifest,
            ...(llmRequest === undefined ? {} : { llm: { request: llmRequest, unknowns: [] } }),
            failure: {
              category: "provider",
              code: "unsupported_response_kind",
              message: "the model did not return a text message",
            },
          });
          continue;
        }
        responseMetadata = facts.metadata;
        responseMetadataInvalid = facts.invalidMetadata;
        if (facts.metadata?.finishReason === "length") {
          attempts.push({
            id,
            index,
            status: "failed",
            startedAt,
            finishedAt: clock.now().toISOString(),
            evidenceBundle: manifest,
            ...(llmRequest === undefined
              ? {}
              : {
                  llm: {
                    request: llmRequest,
                    ...(facts.metadata === undefined ? {} : { response: facts.metadata }),
                    unknowns: unknownFacts(facts.metadata, facts.invalidMetadata),
                  },
                }),
            failure: {
              category: "provider",
              code: "truncated_response",
              message: "the model stopped because of a token limit",
            },
          });
          continue;
        }
        const parsed = parseReviewResponse(facts.content);
        if (!parsed.ok) {
          attempts.push({
            id,
            index,
            status: "failed",
            startedAt,
            finishedAt: clock.now().toISOString(),
            evidenceBundle: manifest,
            ...(llmRequest === undefined
              ? {}
              : {
                  llm: {
                    request: llmRequest,
                    ...(facts.metadata === undefined ? {} : { response: facts.metadata }),
                    unknowns: unknownFacts(facts.metadata, facts.invalidMetadata),
                  },
                }),
            failure: {
              category: "provider",
              code: parsed.issues[0]?.code ?? "invalid_response",
              message: parsed.issues[0]?.message ?? "the response could not be read",
            },
          });
          continue;
        }
        raw = parsed.verdicts;
      }

      const assessed = assess(definition, raw, manifest);
      assessments.push(assessed);
      const finishedAt = clock.now().toISOString();
      const llm =
        llmRequest === undefined
          ? undefined
          : {
              request: llmRequest,
              ...(responseMetadata === undefined ? {} : { response: responseMetadata }),
              unknowns: unknownFacts(responseMetadata, responseMetadataInvalid),
            };
      if (assessed.issues.length === 0) {
        const runId = nextId("run");
        const run = {
          schema: "lorelum.judge.measurement-run/v2" as const,
          id: runId,
          definitionIdentity: prepared.definitionIdentity,
          instrumentIdentity: prepared.instrumentIdentity,
          instrumentSource: "declared" as const,
          executionId,
          evidenceIdentity: prepared.evidenceIdentity,
          ...(renderIdentity === undefined ? {} : { renderIdentity }),
          verdicts: [...assessed.verdicts],
        };
        attempts.push({
          id,
          index,
          status: "completed",
          startedAt,
          finishedAt,
          evidenceBundle: manifest,
          run,
          ...(llm === undefined ? {} : { llm }),
        });
      } else if (assessed.verdicts.length > 0) {
        attempts.push({
          id,
          index,
          status: "partial",
          startedAt,
          finishedAt,
          evidenceBundle: manifest,
          verdicts: [...assessed.verdicts],
          issues: [...assessed.issues],
          ...(llm === undefined ? {} : { llm }),
        });
      } else {
        attempts.push({
          id,
          index,
          status: "failed",
          startedAt,
          finishedAt,
          evidenceBundle: manifest,
          issues: [...assessed.issues],
          ...(llm === undefined ? {} : { llm }),
          failure: {
            category: "execution",
            code: "no_valid_verdict",
            message: "the response contained no legal verdict for any criterion",
          },
        });
      }
    } catch (error) {
      const finishedAt = clock.now().toISOString();
      if (error instanceof ReviewAbortError || activeSignal.aborted) {
        attempts.push({ id, index, status: "cancelled", startedAt, finishedAt });
        continue;
      }
      const failure: ReviewFailure =
        method.kind === "llm"
          ? (() => {
              const provider = providerFailure(error);
              return {
                category: provider.category,
                code: provider.code,
                message: `model transport failed: ${provider.code}`,
                ...(provider.status === undefined ? {} : { httpStatus: provider.status }),
              };
            })()
          : (() => {
              let rawMessage = "";
              try {
                rawMessage = error instanceof Error ? error.message : "";
              } catch {
                rawMessage = "";
              }
              return {
                category: "execution",
                code: "checker_error",
                message: safeFailureMessage(rawMessage),
              };
            })();
      attempts.push({
        id,
        index,
        status: "failed",
        startedAt,
        finishedAt,
        evidenceBundle: manifest,
        ...(method.kind === "llm"
          ? {
              llm: {
                request: llmRequestFacts(method, promptIdentity, renderIdentity, timeoutMs),
                unknowns: ["response_metadata_missing"],
              },
            }
          : {}),
        failure,
      });
    } finally {
      activeSignal.removeEventListener("abort", abortAttempt);
    }
  }

  const execution: ReviewExecution = {
    schema: "lorelum.judge.review-execution/v1",
    id: executionId,
    inputIdentity: prepared.inputIdentity,
    definitionIdentity: prepared.definitionIdentity,
    instrumentIdentity: prepared.instrumentIdentity,
    plannedCount: repetitions,
    // repetitions >= 1, so every attempt slot is represented above.
    attempts: attempts as ReviewExecution["attempts"],
  };
  const checked = validateReviewExecution(execution, definition, instrument);
  if (!checked.ok) {
    return { ok: false, issues: checked.issues };
  }
  return {
    ok: true,
    value: {
      definition: definition,
      instrument,
      execution: checked.value,
      findings: aggregateFindings(definition, assessments),
      completeness: reviewCompleteness(checked.value),
    },
  };
}

export async function runPreparedReview(
  prepared: PreparedReview,
  ports: ReviewPorts,
  signal?: AbortSignal,
): Promise<ExecuteReviewResult> {
  try {
    return await runPreparedReviewInner(prepared, ports, signal);
  } catch (error) {
    return {
      ok: false,
      issues: [
        validation(
          "$",
          `prepared review could not run: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        ),
      ],
    };
  }
}

async function execute(input: unknown, ports: ReviewPorts): Promise<ExecuteReviewResult> {
  const signal = isRecord(input) && input.signal instanceof AbortSignal ? input.signal : undefined;
  const prepared = prepareReview(input, ports);
  if (!prepared.ok) return prepared;
  return runPreparedReview(prepared.value, ports, signal);
}

/**
 * Executes one review by default. Inputs are validated and copied before any
 * checker or model call; later mutation of the caller's object cannot change the
 * running review. Explicit repetitions run sequentially with no retry or cache.
 */
export async function executeReview(
  input: ExecuteReviewInput,
  ports: ReviewPorts,
): Promise<ExecuteReviewResult> {
  try {
    return await execute(input, ports);
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

export type { ValidationResult };
