import type { JsonObject, JsonValue } from "./json";

export interface ToolExecutionContext {
  readonly runId: string;
  readonly stepIndex: number;
  readonly signal: AbortSignal;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  execute(input: JsonObject, context: ToolExecutionContext): Promise<JsonValue> | JsonValue;
}

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
}
