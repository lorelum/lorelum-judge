import { describe, expect, test } from "bun:test";

import { referenceRuntime } from "../packages/runtime/src";
import {
  createScriptedModel,
  createToolRegistry,
  DeterministicClock,
  InMemoryRunStore,
  NoopExecutionPort,
  RecordingTelemetry,
} from "../packages/testing/src";

describe("runtime model configuration forwarding", () => {
  test("keeps the config across pause and resume", async () => {
    const model = createScriptedModel([{ kind: "message", content: "done" }]);
    const store = new InMemoryRunStore();
    const ports = {
      model,
      tools: createToolRegistry(),
      execution: new NoopExecutionPort(),
      store,
      clock: new DeterministicClock(),
      telemetry: new RecordingTelemetry(),
    };
    const config = { model: "model-1", temperature: 0, seed: 4 };
    const paused = await referenceRuntime.run(
      {
        runId: "run-resume",
        messages: [{ role: "user", content: "hello" }],
        maxSteps: 0,
        signal: new AbortController().signal,
        modelConfig: config,
      },
      ports,
    );
    expect(paused.status).toBe("paused");
    const resumed = await referenceRuntime.resume(
      {
        runId: "run-resume",
        maxSteps: 1,
        signal: new AbortController().signal,
      },
      ports,
    );
    expect(resumed.ok).toBe(true);
    expect(model.requests[0]?.config).toEqual(config);
  });

  test("passes the provider-neutral config to the model port", async () => {
    const model = createScriptedModel([{ kind: "message", content: "done" }]);
    const run = await referenceRuntime.run(
      {
        runId: "run-config",
        messages: [{ role: "user", content: "hello" }],
        signal: new AbortController().signal,
        modelConfig: { model: "model-1", temperature: 0, topP: 0.9, maxTokens: 32, seed: 4 },
      },
      {
        model,
        tools: createToolRegistry(),
        execution: new NoopExecutionPort(),
        store: new InMemoryRunStore(),
        clock: new DeterministicClock(),
        telemetry: new RecordingTelemetry(),
      },
    );
    expect(run.status).toBe("completed");
    expect(model.requests[0]?.config).toEqual({
      model: "model-1",
      temperature: 0,
      topP: 0.9,
      maxTokens: 32,
      seed: 4,
    });
  });
});
