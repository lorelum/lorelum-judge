import type { ValidationIssue, ValidationResult } from "@lorelum/judge-protocol";

import type { JsonObject, JsonValue } from "./json.js";

export type RuntimeMessageRole = "system" | "user" | "assistant" | "tool";

export interface RuntimeMessage {
  readonly role: RuntimeMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

/**
 * Provider-neutral generation settings. Only fields the caller set are present;
 * a provider must send exactly these and must not invent server defaults.
 */
export interface ModelGenerationConfig {
  readonly model: string;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly seed?: number;
}

/**
 * A model-port failure with safe, caller-readable identity. Providers should throw
 * this (or a subclass) so callers do not have to guess from arbitrary `code`
 * properties; transport bodies and credentials never belong here.
 */
export class ModelPortError extends Error {
  readonly code: string;
  readonly httpStatus: number | undefined;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = "ModelPortError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isModelPortError(error: unknown): error is ModelPortError {
  return error instanceof ModelPortError;
}

function generationIssue(path: string, message: string): ValidationIssue {
  return { path, code: "schema", message };
}

/** Canonical generation validation shared by providers and callers. */
export function validateGenerationConfig(input: unknown): ValidationResult<ModelGenerationConfig> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [generationIssue("$.config", "config must be an object")] };
  }
  const config = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(config)) {
    if (!["model", "temperature", "topP", "maxTokens", "seed"].includes(key)) {
      issues.push(generationIssue(`$.config.${key}`, `unsupported generation parameter "${key}"`));
    }
  }
  if (typeof config.model !== "string" || config.model.length === 0) {
    issues.push(generationIssue("$.config.model", "model must be a non-empty string"));
  }
  if (
    config.temperature !== undefined &&
    (typeof config.temperature !== "number" ||
      !Number.isFinite(config.temperature) ||
      config.temperature < 0)
  ) {
    issues.push(
      generationIssue("$.config.temperature", "temperature must be a finite number at least 0"),
    );
  }
  if (
    config.topP !== undefined &&
    (typeof config.topP !== "number" ||
      !Number.isFinite(config.topP) ||
      config.topP < 0 ||
      config.topP > 1)
  ) {
    issues.push(generationIssue("$.config.topP", "topP must be a finite number between 0 and 1"));
  }
  if (
    config.maxTokens !== undefined &&
    (typeof config.maxTokens !== "number" ||
      !Number.isSafeInteger(config.maxTokens) ||
      config.maxTokens < 1)
  ) {
    issues.push(generationIssue("$.config.maxTokens", "maxTokens must be a positive safe integer"));
  }
  if (
    config.seed !== undefined &&
    (typeof config.seed !== "number" || !Number.isSafeInteger(config.seed) || config.seed < 0)
  ) {
    issues.push(generationIssue("$.config.seed", "seed must be a non-negative safe integer"));
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: config as unknown as ModelGenerationConfig };
}

/**
 * Whitelisted response facts. `model` is the server's declaration, not proof of
 * the weights or decoding used remotely.
 */
export interface ModelResponseMetadata {
  readonly provider?: string;
  readonly model?: string;
  readonly responseId?: string;
  readonly finishReason?: string;
  readonly status?: string;
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  };
}

export interface ModelRequest {
  readonly runId: string;
  readonly stepIndex: number;
  readonly messages: readonly RuntimeMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly signal: AbortSignal;
  readonly config?: ModelGenerationConfig;
}

export type ModelResponse =
  | {
      readonly kind: "message";
      readonly content: string;
      readonly metadata?: ModelResponseMetadata;
    }
  | {
      readonly kind: "tool_calls";
      readonly content?: string;
      readonly calls: readonly ToolCall[];
    }
  | {
      readonly kind: "structured";
      readonly content?: string;
      readonly value: JsonValue;
    };

export interface ModelPort {
  generate(request: ModelRequest): Promise<ModelResponse>;
}
