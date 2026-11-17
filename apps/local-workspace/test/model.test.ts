import { describe, expect, test } from "bun:test";
import { PlanningSession } from "@lorelum/judge-workflow";
import { createConfiguredModel, createOfflineModel } from "../src/model.js";

const signal = new AbortController().signal;
describe("local workspace model ports", () => {
  test("offline planning uses the selected file and explicit revision", async () => {
    const model = createOfflineModel({
      targetPath: "src/note.txt",
      replacement: "updated",
      checkDescription: "verify file",
    });
    const task = {
      schema: "lorelum.judge.task-contract/v1" as const,
      id: "task",
      taskClass: "code",
      text: "Update my note",
    };
    const sources = [
      {
        id: "request",
        kind: "user" as const,
        locator: "user",
        version: "1",
        content: task.text,
        status: "available" as const,
      },
    ];
    const session = new PlanningSession("plan", { task, sources });
    const preview = session.previewModelDisclosure(model, "Keep the change focused");
    const grant = session.authorizeModelDisclosure(model, preview.identity);
    if (!grant.ok) throw new Error("disclosure rejected");
    const result = await session.generate({
      model,
      runId: "offline",
      signal,
      instructions: "Keep the change focused",
      disclosureIdentity: grant.value,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("planning failed");
    expect(result.value.plan.scope).toEqual(["src/note.txt"]);
    expect(result.value.plan.steps[0]?.description).toBe("Keep the change focused");
    expect(result.value.acceptanceProposed).toBe(true);
  });

  test("configured port calls the configured local endpoint and rejects config substitution", async () => {
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        calls++;
        const body = (await request.json()) as { model: string; temperature: number };
        expect(body.model).toBe("demo");
        expect(body.temperature).toBe(0);
        return Response.json({
          choices: [{ message: { content: "real transport" }, finish_reason: "stop" }],
        });
      },
    });
    try {
      const fixed = createConfiguredModel({
        endpoint: `http://127.0.0.1:${server.port}/v1`,
        config: { model: "demo", temperature: 0 },
      });
      const request = {
        runId: "test",
        stepIndex: 0,
        signal,
        tools: [],
        messages: [{ role: "user" as const, content: "hello" }],
      };
      const response = await fixed.model.generate(request);
      expect(response.kind).toBe("message");
      const reordered = await fixed.model.generate({
        ...request,
        config: { temperature: 0, model: "demo" },
      });
      expect(reordered.kind).toBe("message");
      await expect(
        fixed.model.generate({ ...request, config: { model: "other" } }),
      ).rejects.toThrow("differs");
      expect(calls).toBe(2);
    } finally {
      server.stop(true);
    }
  });
});
