import type { ExecutionPort } from "./execution";
import type { ModelPort } from "./model";
import type { RuntimeEvent, RuntimeRun } from "./run";
import type { ToolRegistry } from "./tools";

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
