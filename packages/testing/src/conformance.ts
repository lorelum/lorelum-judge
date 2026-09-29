import {
  type AgentRuntime,
  type ModelResponse,
  RuntimeFailureError,
  type RuntimePorts,
  type RuntimeRun,
  type ToolDefinition,
} from "@lorelum/judge-runtime";

import {
  createToolRegistry,
  DeterministicClock,
  InMemoryRunStore,
  NoopExecutionPort,
  RecordingTelemetry,
} from "./memory";
import { createScriptedModel, type ScriptedModel } from "./scripted-model";

export interface TestPortsOptions {
  readonly responses: readonly (ModelResponse | Error)[];
  readonly tools?: readonly ToolDefinition[];
}

export interface TestPorts extends RuntimePorts {
  readonly model: ScriptedModel;
  readonly store: InMemoryRunStore;
  readonly clock: DeterministicClock;
  readonly telemetry: RecordingTelemetry;
}

export interface RuntimeConformanceCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: string;
}

export interface RuntimeConformanceReport {
  readonly passed: boolean;
  readonly cases: readonly RuntimeConformanceCaseResult[];
}

export function createTestPorts(options: TestPortsOptions): TestPorts {
  return {
    model: createScriptedModel(options.responses),
    tools: createToolRegistry(options.tools),
    execution: new NoopExecutionPort(),
    store: new InMemoryRunStore(),
    clock: new DeterministicClock(),
    telemetry: new RecordingTelemetry(),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function userMessage(content: string) {
  return { role: "user" as const, content };
}

async function expectCompleted(run: RuntimeRun, output: unknown): Promise<void> {
  assert(run.status === "completed", `Expected completed, received ${run.status}.`);
  assert(
    JSON.stringify(run.output) === JSON.stringify(output),
    `Unexpected output: ${JSON.stringify(run.output)}`,
  );
  assert(run.events.at(-1)?.type === "run_completed", "Missing run_completed event.");
}

async function textCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({
    responses: [{ kind: "message", content: "done" }],
  });
  const run = await runtime.run(
    { runId: "text", messages: [userMessage("hello")], signal: new AbortController().signal },
    ports,
  );
  await expectCompleted(run, "done");
  assert(ports.model.requests.length === 1, "Expected one model request.");
  assert(run.steps.length === 1, "Completed run did not record one step.");
  assert(run.steps[0]?.responseKind === "message", "Text step kind was not recorded.");
  assert((await ports.store.load("text"))?.status === "completed", "Run was not persisted.");
}

async function toolCase(runtime: AgentRuntime): Promise<void> {
  const tool: ToolDefinition = {
    name: "lookup",
    description: "Look up a value.",
    inputSchema: { type: "object" },
    execute(input) {
      return { value: input.key ?? null };
    },
  };
  const ports = createTestPorts({
    responses: [
      {
        kind: "tool_calls",
        calls: [{ id: "call-1", name: "lookup", arguments: { key: "answer" } }],
      },
      { kind: "message", content: "finished" },
    ],
    tools: [tool],
  });
  const run = await runtime.run(
    { runId: "tool", messages: [userMessage("lookup")], signal: new AbortController().signal },
    ports,
  );
  await expectCompleted(run, "finished");
  assert(ports.model.requests.length === 2, "Expected two model requests.");
  assert(run.steps[0]?.responseKind === "tool_calls", "Tool step kind was not recorded.");
  assert(run.steps[0]?.toolCallIds[0] === "call-1", "Tool call id was not recorded.");
  const secondRequest = ports.model.requests[1];
  assert(secondRequest !== undefined, "Missing second model request.");
  assert(
    secondRequest.messages.some(
      (message) => message.role === "tool" && message.toolCallId === "call-1",
    ),
    "Tool result was not included in the next request.",
  );
}

async function structuredCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({
    responses: [{ kind: "structured", value: { approved: true } }],
  });
  const run = await runtime.run(
    {
      runId: "structured",
      messages: [userMessage("return json")],
      signal: new AbortController().signal,
    },
    ports,
  );
  await expectCompleted(run, { approved: true });
}

async function cancellationCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({
    responses: [{ kind: "message", content: "must not run" }],
  });
  const controller = new AbortController();
  controller.abort();
  const run = await runtime.run(
    { runId: "cancel", messages: [userMessage("cancel")], signal: controller.signal },
    ports,
  );
  assert(run.status === "cancelled", `Expected cancelled, received ${run.status}.`);
  assert(ports.model.requests.length === 0, "Model ran after cancellation.");
  assert(run.events.at(-1)?.type === "run_cancelled", "Missing run_cancelled event.");
}

async function toolCancellationCase(runtime: AgentRuntime): Promise<void> {
  const controller = new AbortController();
  const tool: ToolDefinition = {
    name: "cancel",
    description: "Cancel the run while executing.",
    inputSchema: { type: "object" },
    execute() {
      controller.abort();
      throw new Error("cancelled during tool execution");
    },
  };
  const ports = createTestPorts({
    responses: [
      {
        kind: "tool_calls",
        calls: [{ id: "call-cancel", name: "cancel", arguments: {} }],
      },
    ],
    tools: [tool],
  });
  const run = await runtime.run(
    { runId: "cancel-tool", messages: [userMessage("cancel")], signal: controller.signal },
    ports,
  );
  assert(run.status === "cancelled", `Expected cancelled, received ${run.status}.`);
  assert(
    run.events.some((event) => event.type === "tool_started"),
    "Cancellation lost the tool_started checkpoint.",
  );
}

async function resumeCase(runtime: AgentRuntime): Promise<void> {
  const tool: ToolDefinition = {
    name: "lookup",
    description: "Look up a value.",
    inputSchema: { type: "object" },
    execute() {
      return { value: 42 };
    },
  };
  const ports = createTestPorts({
    responses: [
      {
        kind: "tool_calls",
        calls: [{ id: "call-1", name: "lookup", arguments: {} }],
      },
      { kind: "message", content: "resumed" },
    ],
    tools: [tool],
  });
  const paused = await runtime.run(
    {
      runId: "resume",
      messages: [userMessage("pause")],
      maxSteps: 1,
      signal: new AbortController().signal,
    },
    ports,
  );
  assert(paused.status === "paused", `Expected paused, received ${paused.status}.`);
  assert(paused.events.at(-1)?.type === "run_paused", "Missing run_paused event.");

  const resumed = await runtime.resume(
    { runId: "resume", maxSteps: 2, signal: new AbortController().signal },
    ports,
  );
  assert(resumed.ok, "Expected resume to succeed.");
  await expectCompleted(resumed.run, "resumed");
  assert(ports.model.requests.length === 2, "Resume did not make the next model request.");
  const resumedRequest = ports.model.requests[1];
  assert(resumedRequest !== undefined, "Missing resumed model request.");
  assert(
    resumedRequest.messages.some(
      (message) => message.role === "tool" && message.toolCallId === "call-1",
    ),
    "Resume did not restore the persisted tool result.",
  );
}

async function stepCheckpointCase(runtime: AgentRuntime): Promise<void> {
  const tool: ToolDefinition = {
    name: "checkpoint",
    description: "Return a persisted result.",
    inputSchema: { type: "object" },
    execute() {
      return { persisted: true };
    },
  };
  const ports = createTestPorts({
    responses: [
      {
        kind: "tool_calls",
        calls: [{ id: "call-checkpoint", name: "checkpoint", arguments: {} }],
      },
      new Error("model failed after checkpoint"),
    ],
    tools: [tool],
  });
  const run = await runtime.run(
    {
      runId: "step-checkpoint",
      messages: [userMessage("checkpoint")],
      signal: new AbortController().signal,
    },
    ports,
  );
  assert(run.status === "failed", `Expected failed, received ${run.status}.`);
  const persisted = await ports.store.load("step-checkpoint");
  assert(persisted !== undefined, "Step checkpoint was not persisted.");
  assert(persisted.stepIndex === 1, `Expected checkpoint step 1, received ${persisted.stepIndex}.`);
  assert(
    persisted.messages.some(
      (message) => message.role === "tool" && message.toolCallId === "call-checkpoint",
    ),
    "Step checkpoint lost the tool result.",
  );
  assert(
    persisted.events.some((event) => event.type === "step_completed"),
    "Step checkpoint lost the step_completed event.",
  );
  assert(persisted.steps.length === 1, "Step checkpoint did not record the completed step.");
}

async function missingResumeCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({ responses: [] });
  const result = await runtime.resume(
    { runId: "missing", signal: new AbortController().signal },
    ports,
  );
  assert(!result.ok, "Missing run unexpectedly resumed.");
  assert(result.failure.kind === "protocol_error", "Missing run did not return protocol_error.");
}

async function modelFailureCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({ responses: [new Error("model unavailable")] });
  const run = await runtime.run(
    { runId: "model-error", messages: [userMessage("fail")], signal: new AbortController().signal },
    ports,
  );
  assert(run.status === "failed", `Expected failed, received ${run.status}.`);
  assert(run.failure?.kind === "model_error", "Model failure was not classified as model_error.");
}

async function environmentFailureCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({
    responses: [new RuntimeFailureError("environment_error", "missing credential")],
  });
  const run = await runtime.run(
    {
      runId: "environment-error",
      messages: [userMessage("fail")],
      signal: new AbortController().signal,
    },
    ports,
  );
  assert(run.status === "failed", `Expected failed, received ${run.status}.`);
  assert(run.failure?.kind === "environment_error", "Environment failure was not preserved.");
}

async function toolFailureCase(runtime: AgentRuntime): Promise<void> {
  const tool: ToolDefinition = {
    name: "explode",
    description: "Throw an error.",
    inputSchema: { type: "object" },
    execute() {
      throw new Error("tool exploded");
    },
  };
  const ports = createTestPorts({
    responses: [
      {
        kind: "tool_calls",
        calls: [{ id: "call-1", name: "explode", arguments: {} }],
      },
    ],
    tools: [tool],
  });
  const run = await runtime.run(
    { runId: "tool-error", messages: [userMessage("fail")], signal: new AbortController().signal },
    ports,
  );
  assert(run.status === "failed", `Expected failed, received ${run.status}.`);
  assert(run.failure?.kind === "tool_error", "Tool failure was not classified as tool_error.");
  assert(
    run.events.some((event) => event.type === "tool_started"),
    "Tool failure lost the tool_started event.",
  );
}

async function unknownToolCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({
    responses: [
      {
        kind: "tool_calls",
        calls: [{ id: "call-1", name: "missing", arguments: {} }],
      },
    ],
  });
  const run = await runtime.run(
    {
      runId: "protocol-error",
      messages: [userMessage("fail")],
      signal: new AbortController().signal,
    },
    ports,
  );
  assert(run.status === "failed", `Expected failed, received ${run.status}.`);
  assert(
    run.failure?.kind === "protocol_error",
    "Unknown tool was not classified as protocol_error.",
  );
}

async function emptyToolCallCase(runtime: AgentRuntime): Promise<void> {
  const ports = createTestPorts({
    responses: [{ kind: "tool_calls", calls: [] }],
  });
  const run = await runtime.run(
    {
      runId: "empty-tool-call",
      messages: [userMessage("fail")],
      signal: new AbortController().signal,
    },
    ports,
  );
  assert(run.status === "failed", `Expected failed, received ${run.status}.`);
  assert(
    run.failure?.kind === "protocol_error",
    "Empty tool call list was not classified as protocol_error.",
  );
}

const conformanceCases: ReadonlyArray<{
  readonly name: string;
  readonly execute: (runtime: AgentRuntime) => Promise<void>;
}> = [
  { name: "text response", execute: textCase },
  { name: "tool call round trip", execute: toolCase },
  { name: "structured output", execute: structuredCase },
  { name: "cancellation", execute: cancellationCase },
  { name: "tool cancellation", execute: toolCancellationCase },
  { name: "pause and resume", execute: resumeCase },
  { name: "step checkpoint", execute: stepCheckpointCase },
  { name: "missing resume state", execute: missingResumeCase },
  { name: "model failure", execute: modelFailureCase },
  { name: "environment failure", execute: environmentFailureCase },
  { name: "tool failure", execute: toolFailureCase },
  { name: "unknown tool", execute: unknownToolCase },
  { name: "empty tool call list", execute: emptyToolCallCase },
];

export async function runRuntimeConformance(
  runtime: AgentRuntime,
): Promise<RuntimeConformanceReport> {
  const cases: RuntimeConformanceCaseResult[] = [];

  for (const conformanceCase of conformanceCases) {
    try {
      await conformanceCase.execute(runtime);
      cases.push({ name: conformanceCase.name, passed: true });
    } catch (error) {
      cases.push({
        name: conformanceCase.name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    passed: cases.every((result) => result.passed),
    cases,
  };
}
