import { toRuntimeFailure } from "./errors.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { ModelResponse, RuntimeMessage } from "./model.js";
import type { RuntimePorts } from "./ports.js";
import type {
  ResumeRequest,
  ResumeResult,
  RuntimeEvent,
  RuntimeFailure,
  RuntimeRequest,
  RuntimeRun,
  RuntimeStep,
} from "./run.js";
import type { AgentRuntime } from "./runtime.js";

const RUN_SCHEMA = "lorelum.runtime.run/v1" as const;
const DEFAULT_MAX_STEPS = 8;
const FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function timestamp(ports: RuntimePorts): string {
  return ports.clock.now().toISOString();
}

function safeTimestamp(
  ports: RuntimePorts,
  fallback: string,
): {
  readonly at: string;
  readonly failure?: RuntimeFailure;
} {
  try {
    return { at: timestamp(ports) };
  } catch (error) {
    return {
      at: fallback,
      failure: toRuntimeFailure(error, "environment_error"),
    };
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addFailureDetail(failure: RuntimeFailure, key: string, detail: unknown): RuntimeFailure {
  const existing =
    failure.details !== undefined &&
    typeof failure.details === "object" &&
    failure.details !== null &&
    !Array.isArray(failure.details)
      ? (failure.details as JsonObject)
      : failure.details === undefined
        ? {}
        : { cause: failure.details };

  return {
    ...failure,
    details: {
      ...existing,
      [key]: failureMessage(detail),
    },
  };
}

function createRun(request: RuntimeRequest, ports: RuntimePorts): RuntimeRun {
  const now = timestamp(ports);
  return {
    schema: RUN_SCHEMA,
    runId: request.runId,
    status: "running",
    stepIndex: 0,
    maxSteps: request.maxSteps ?? DEFAULT_MAX_STEPS,
    messages: [...request.messages],
    steps: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createFallbackRun(request: RuntimeRequest): RuntimeRun {
  return {
    schema: RUN_SCHEMA,
    runId: request.runId,
    status: "running",
    stepIndex: 0,
    maxSteps: request.maxSteps ?? DEFAULT_MAX_STEPS,
    messages: [...request.messages],
    steps: [],
    events: [],
    createdAt: FALLBACK_TIMESTAMP,
    updatedAt: FALLBACK_TIMESTAMP,
  };
}

async function appendEvent(
  run: RuntimeRun,
  ports: RuntimePorts,
  event: RuntimeEvent,
): Promise<RuntimeRun> {
  await ports.telemetry.emit(event);
  return {
    ...run,
    events: [...run.events, event],
    updatedAt: event.at,
  };
}

function eventBase(run: RuntimeRun, ports: RuntimePorts) {
  return {
    runId: run.runId,
    at: timestamp(ports),
    stepIndex: run.stepIndex,
  };
}

async function finishFailed(
  run: RuntimeRun,
  ports: RuntimePorts,
  failure: RuntimeFailure,
): Promise<RuntimeRun> {
  const clock = safeTimestamp(ports, run.updatedAt);
  let effectiveFailure =
    clock.failure === undefined
      ? failure
      : addFailureDetail(failure, "clock_error", clock.failure.message);

  let event: Extract<RuntimeEvent, { type: "run_failed" }> = {
    runId: run.runId,
    at: clock.at,
    stepIndex: run.stepIndex,
    type: "run_failed",
    failure: effectiveFailure,
  };

  try {
    await ports.telemetry.emit(event);
  } catch (error) {
    effectiveFailure = addFailureDetail(effectiveFailure, "telemetry_error", error);
    event = { ...event, failure: effectiveFailure };
  }

  const failed: RuntimeRun = {
    ...run,
    status: "failed",
    failure: effectiveFailure,
    events: [...run.events, event],
    updatedAt: clock.at,
  };

  try {
    await ports.store.save(failed);
    return failed;
  } catch (error) {
    effectiveFailure = addFailureDetail(effectiveFailure, "store_error", error);
    const updatedEvent = { ...event, failure: effectiveFailure };
    return {
      ...failed,
      failure: effectiveFailure,
      events: [...run.events, updatedEvent],
    };
  }
}

async function finishCancelled(run: RuntimeRun, ports: RuntimePorts): Promise<RuntimeRun> {
  const cancelled: RuntimeRun = {
    ...run,
    status: "cancelled",
    updatedAt: timestamp(ports),
  };
  const withEvent = await appendEvent(cancelled, ports, {
    ...eventBase(cancelled, ports),
    type: "run_cancelled",
  });
  await ports.store.save(withEvent);
  return withEvent;
}

async function finishCompleted(
  run: RuntimeRun,
  ports: RuntimePorts,
  messages: readonly RuntimeMessage[],
  step: RuntimeStep,
  output: JsonValue,
): Promise<RuntimeRun> {
  const completedStepIndex = run.stepIndex;
  const completed: RuntimeRun = {
    ...run,
    status: "completed",
    stepIndex: completedStepIndex + 1,
    messages,
    steps: [...run.steps, step],
    output,
    updatedAt: timestamp(ports),
  };
  const withStep = await appendEvent(completed, ports, {
    runId: completed.runId,
    at: timestamp(ports),
    stepIndex: completedStepIndex,
    type: "step_completed",
  });
  const finalRun = await appendEvent(withStep, ports, {
    runId: withStep.runId,
    at: timestamp(ports),
    stepIndex: completedStepIndex,
    type: "run_completed",
  });
  await ports.store.save(finalRun);
  return finalRun;
}

function assistantMessage(response: ModelResponse): RuntimeMessage {
  switch (response.kind) {
    case "message":
      return { role: "assistant", content: response.content };
    case "tool_calls":
      return {
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.calls,
      };
    case "structured":
      return {
        role: "assistant",
        content: response.content ?? JSON.stringify(response.value),
      };
  }
}

async function executeTools(
  run: RuntimeRun,
  ports: RuntimePorts,
  response: Extract<ModelResponse, { kind: "tool_calls" }>,
  signal: AbortSignal,
): Promise<
  | { readonly ok: true; readonly run: RuntimeRun }
  | { readonly ok: false; readonly run: RuntimeRun; readonly failure: RuntimeFailure }
> {
  if (response.calls.length === 0) {
    return {
      ok: false,
      run,
      failure: {
        kind: "protocol_error",
        message: "Model returned an empty tool call list.",
        retryable: false,
      },
    };
  }

  let current: RuntimeRun = {
    ...run,
    messages: [...run.messages, assistantMessage(response)],
    updatedAt: timestamp(ports),
  };

  for (const call of response.calls) {
    current = await appendEvent(current, ports, {
      ...eventBase(current, ports),
      type: "tool_started",
      toolCallId: call.id,
      toolName: call.name,
    });

    const tool = ports.tools.get(call.name);
    if (tool === undefined) {
      return {
        ok: false,
        run: current,
        failure: {
          kind: "protocol_error",
          message: `Unknown tool: ${call.name}`,
          retryable: false,
          details: { toolCallId: call.id, toolName: call.name },
        },
      };
    }

    let result: JsonValue;
    try {
      result = await tool.execute(call.arguments, {
        runId: current.runId,
        stepIndex: current.stepIndex,
        signal,
      });
    } catch (error) {
      return {
        ok: false,
        run: current,
        failure: toRuntimeFailure(error, "tool_error"),
      };
    }

    current = {
      ...current,
      messages: [
        ...current.messages,
        {
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: call.id,
        },
      ],
      updatedAt: timestamp(ports),
    };
    current = await appendEvent(current, ports, {
      ...eventBase(current, ports),
      type: "tool_completed",
      toolCallId: call.id,
      toolName: call.name,
    });
  }

  return { ok: true, run: current };
}

async function executeRun(
  initialRun: RuntimeRun,
  signal: AbortSignal,
  ports: RuntimePorts,
): Promise<RuntimeRun> {
  let run = initialRun;

  try {
    while (run.status === "running") {
      if (signal.aborted) {
        return finishCancelled(run, ports);
      }

      if (run.stepIndex >= run.maxSteps) {
        const paused: RuntimeRun = {
          ...run,
          status: "paused",
          updatedAt: timestamp(ports),
        };
        const withEvent = await appendEvent(paused, ports, {
          ...eventBase(paused, ports),
          type: "run_paused",
        });
        await ports.store.save(withEvent);
        return withEvent;
      }

      run = await appendEvent(run, ports, {
        ...eventBase(run, ports),
        type: "model_requested",
      });

      let response: ModelResponse;
      try {
        response = await ports.model.generate({
          runId: run.runId,
          stepIndex: run.stepIndex,
          messages: run.messages,
          tools: ports.tools.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          return finishCancelled(run, ports);
        }
        return finishFailed(run, ports, toRuntimeFailure(error, "model_error"));
      }

      run = await appendEvent(run, ports, {
        ...eventBase(run, ports),
        type: "model_responded",
        responseKind: response.kind,
      });

      if (response.kind === "message") {
        return finishCompleted(
          run,
          ports,
          [...run.messages, assistantMessage(response)],
          {
            index: run.stepIndex,
            responseKind: "message",
            toolCallIds: [],
          },
          response.content,
        );
      }

      if (response.kind === "structured") {
        return finishCompleted(
          run,
          ports,
          [...run.messages, assistantMessage(response)],
          {
            index: run.stepIndex,
            responseKind: "structured",
            toolCallIds: [],
          },
          response.value,
        );
      }

      const toolOutcome = await executeTools(run, ports, response, signal);
      if (!toolOutcome.ok) {
        if (signal.aborted) {
          return finishCancelled(toolOutcome.run, ports);
        }
        return finishFailed(toolOutcome.run, ports, toolOutcome.failure);
      }

      const completedStepIndex = toolOutcome.run.stepIndex;
      run = await appendEvent(toolOutcome.run, ports, {
        ...eventBase(toolOutcome.run, ports),
        type: "step_completed",
      });
      run = {
        ...run,
        stepIndex: completedStepIndex + 1,
        steps: [
          ...run.steps,
          {
            index: completedStepIndex,
            responseKind: "tool_calls",
            toolCallIds: response.calls.map((call) => call.id),
          },
        ],
      };
      await ports.store.save(run);
    }

    return run;
  } catch (error) {
    return finishFailed(run, ports, toRuntimeFailure(error, "environment_error"));
  }
}

export class ReferenceRuntime implements AgentRuntime {
  async run(request: RuntimeRequest, ports: RuntimePorts): Promise<RuntimeRun> {
    let run: RuntimeRun | undefined;

    try {
      run = createRun(request, ports);
      run = await appendEvent(run, ports, {
        ...eventBase(run, ports),
        type: "run_started",
      });
      return await executeRun(run, request.signal, ports);
    } catch (error) {
      return finishFailed(
        run ?? createFallbackRun(request),
        ports,
        toRuntimeFailure(error, "environment_error"),
      );
    }
  }

  async resume(request: ResumeRequest, ports: RuntimePorts): Promise<ResumeResult> {
    let stored: RuntimeRun | undefined;
    try {
      stored = await ports.store.load(request.runId);
    } catch (error) {
      return {
        ok: false,
        failure: toRuntimeFailure(error, "environment_error"),
      };
    }

    if (stored === undefined) {
      return {
        ok: false,
        failure: {
          kind: "protocol_error",
          message: `Run not found: ${request.runId}`,
          retryable: false,
        },
      };
    }

    if (stored.status !== "running" && stored.status !== "paused") {
      return {
        ok: false,
        failure: {
          kind: "protocol_error",
          message: `Run is not resumable from status: ${stored.status}`,
          retryable: false,
        },
      };
    }

    const nextMaxSteps =
      request.maxSteps !== undefined && request.maxSteps > stored.maxSteps
        ? request.maxSteps
        : stored.maxSteps;

    if (stored.stepIndex >= nextMaxSteps) {
      return {
        ok: false,
        failure: {
          kind: "protocol_error",
          message: `Run has no step budget remaining: ${request.runId}`,
          retryable: false,
        },
      };
    }

    let updatedAt: string;
    try {
      updatedAt = timestamp(ports);
    } catch (error) {
      return {
        ok: false,
        failure: toRuntimeFailure(error, "environment_error"),
      };
    }

    const resumable: RuntimeRun = {
      ...stored,
      status: "running",
      maxSteps: nextMaxSteps,
      updatedAt,
    };
    const run = await executeRun(resumable, request.signal, ports);
    return { ok: true, run };
  }
}

export const referenceRuntime = new ReferenceRuntime();
