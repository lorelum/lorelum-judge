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
