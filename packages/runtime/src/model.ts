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

export interface ModelRequest {
  readonly runId: string;
  readonly stepIndex: number;
  readonly messages: readonly RuntimeMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly signal: AbortSignal;
}

export type ModelResponse =
  | {
      readonly kind: "message";
      readonly content: string;
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
