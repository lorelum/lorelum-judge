import type { ExecutionPort } from "./execution.js";
import type { ModelPort } from "./model.js";
import type { RuntimeEvent, RuntimeRun } from "./run.js";
import type { ToolRegistry } from "./tools.js";

export interface RunStore {
  load(runId: string): Promise<RuntimeRun | undefined>;
  save(run: RuntimeRun): Promise<void>;
}

export interface ClockPort {
  now(): Date;
}

export interface TelemetryPort {
  emit(event: RuntimeEvent): Promise<void> | void;
}

export interface RuntimePorts {
  readonly model: ModelPort;
  readonly tools: ToolRegistry;
  readonly execution: ExecutionPort;
  readonly store: RunStore;
  readonly clock: ClockPort;
  readonly telemetry: TelemetryPort;
}
