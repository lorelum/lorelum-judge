import { toRuntimeFailure } from "./errors";
import type { JsonValue } from "./json";
import type { ModelResponse, RuntimeMessage } from "./model";
import type { RuntimePorts } from "./ports";
import type {
  ResumeRequest,
  ResumeResult,
  RuntimeEvent,
  RuntimeFailure,
  RuntimeRequest,
  RuntimeRun,
  RuntimeStep,
} from "./run";
import type { AgentRuntime } from "./runtime";

const RUN_SCHEMA = "lorelum.runtime.run/v1" as const;
const DEFAULT_MAX_STEPS = 8;

function timestamp(ports: RuntimePorts): string {
  return ports.clock.now().toISOString();
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
  const failed: RuntimeRun = {
    ...run,
    status: "failed",
    failure,
    updatedAt: timestamp(ports),
  };
  const withEvent = await appendEvent(failed, ports, {
    ...eventBase(failed, ports),
    type: "run_failed",
    failure,
  });
  await ports.store.save(withEvent);
  return withEvent;
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
  const completed: RuntimeRun = {
    ...run,
    status: "completed",
    stepIndex: run.stepIndex + 1,
    messages,
    steps: [...run.steps, step],
    output,
    updatedAt: timestamp(ports),
  };
  const withStep = await appendEvent(completed, ports, {
    ...eventBase(completed, ports),
    type: "step_completed",
  });
  const finalRun = await appendEvent(withStep, ports, {
    ...eventBase(withStep, ports),
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

  return {
    ok: true,
    run: {
      ...current,
      stepIndex: current.stepIndex + 1,
      steps: [
        ...current.steps,
        {
          index: current.stepIndex,
          responseKind: "tool_calls",
          toolCallIds: response.calls.map((call) => call.id),
        },
      ],
      updatedAt: timestamp(ports),
    },
  };
}

async function executeRun(
  initialRun: RuntimeRun,
  signal: AbortSignal,
  ports: RuntimePorts,
): Promise<RuntimeRun> {
  let run = initialRun;

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

    run = await appendEvent(toolOutcome.run, ports, {
      ...eventBase(toolOutcome.run, ports),
      type: "step_completed",
    });
    await ports.store.save(run);
  }

  return run;
}

export class ReferenceRuntime implements AgentRuntime {
  async run(request: RuntimeRequest, ports: RuntimePorts): Promise<RuntimeRun> {
    let run = createRun(request, ports);
    run = await appendEvent(run, ports, {
      ...eventBase(run, ports),
      type: "run_started",
    });
    return executeRun(run, request.signal, ports);
  }

  async resume(request: ResumeRequest, ports: RuntimePorts): Promise<ResumeResult> {
    const stored = await ports.store.load(request.runId);
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
    const resumable: RuntimeRun = {
      ...stored,
      status: "running",
      maxSteps: nextMaxSteps,
      updatedAt: timestamp(ports),
    };
    const run = await executeRun(resumable, request.signal, ports);
    return { ok: true, run };
  }
}

export const referenceRuntime = new ReferenceRuntime();
