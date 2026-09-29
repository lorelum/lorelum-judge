import type {
  ClockPort,
  ExecutionPort,
  RunStore,
  RuntimeEvent,
  RuntimeRun,
  TelemetryPort,
  ToolDefinition,
  ToolRegistry,
} from "@lorelum/judge-runtime";

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RuntimeRun>();

  async load(runId: string): Promise<RuntimeRun | undefined> {
    const run = this.runs.get(runId);
    return run === undefined ? undefined : structuredClone(run);
  }

  async save(run: RuntimeRun): Promise<void> {
    this.runs.set(run.runId, structuredClone(run));
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }
}

export class DeterministicClock implements ClockPort {
  private currentTime: Date;

  constructor(start = new Date("2026-01-01T00:00:00.000Z")) {
    this.currentTime = new Date(start);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  advance(milliseconds: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + milliseconds);
  }
}

export class RecordingTelemetry implements TelemetryPort {
  readonly events: RuntimeEvent[] = [];

  emit(event: RuntimeEvent): void {
    this.events.push(structuredClone(event));
  }
}

export class StaticToolRegistry implements ToolRegistry {
  private readonly tools: ReadonlyMap<string, ToolDefinition>;

  constructor(tools: readonly ToolDefinition[] = []) {
    const entries = tools.map((tool) => {
      if (tool.name.length === 0) {
        throw new Error("Tool name must not be empty.");
      }
      return [tool.name, tool] as const;
    });
    this.tools = new Map(entries);
    if (this.tools.size !== entries.length) {
      throw new Error("Tool names must be unique.");
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }
}

export function createToolRegistry(tools: readonly ToolDefinition[] = []): ToolRegistry {
  return new StaticToolRegistry(tools);
}

export class NoopExecutionPort implements ExecutionPort {
  async run() {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  }
}
