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
