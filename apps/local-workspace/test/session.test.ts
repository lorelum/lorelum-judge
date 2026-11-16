import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CodeEvaluationReport,
  type CodeSuggestionReport,
  validateWorkflowSessionEvent,
  validateWorkflowSessionEvents,
} from "@lorelum/judge-protocol";
import { SessionRouter } from "../src/session.js";

type State = {
  sessionId: string;
  sequence: number;
  model: { mode: string; recipient: string } | null;
  plan: { identity: string; revision: number; status: string; eligible: boolean } | null;
  disclosure: {
    identity: string;
    request: {
      instructions: string;
      messages: { role: string; content: string }[];
      task: { text: string };
      sources: {
        id: string;
        kind: string;
        locator: string;
        version: string;
        content: string;
        status: string;
      }[];
    };
    authorized: boolean;
  } | null;
  chatDisclosure: {
    identity: string;
    recipient: string;
    mode: string;
    request: { messages: { role: string; content: string }[]; config: { model: string } };
    authorized: boolean;
  } | null;
  chat: { messages: { role: string; content: string }[]; status: string };
  executionDisclosure: {
    identity: string;
    recipient: string;
    request: { messages: unknown[]; config: { model: string } };
  } | null;
  evaluation: {
    status: string;
    report: CodeEvaluationReport | null;
    text: string | null;
    issues: unknown;
  };
  suggestions: {
    status: string;
    report: CodeSuggestionReport | null;
    text: string | null;
    issues: unknown;
  };
  execution: { status: string; proposal: unknown };
};
type Response = { ok: boolean; state: State; error?: { message: string } };
const task = {
  schema: "lorelum.judge.task-contract/v1",
  id: "task",
  taskClass: "code",
  text: "Update the note",
};
const sources = [
  {
    id: "request",
    kind: "user",
    locator: "user",
    version: "1",
    content: task.text,
    status: "available",
  },
];
const offline = {
  targetPath: "note.txt",
  replacement: "new text",
  checkDescription: "Run the check",
};
const call = async (session: SessionRouter, action: string, payload: unknown): Promise<Response> =>
  (await session.dispatch(action, payload)) as Response;

async function createPlan(session: SessionRouter): Promise<State> {
  expect((await call(session, "model.offline", offline)).ok).toBe(true);
  expect(
    (await call(session, "planning.create", { id: "plan", inputs: { task, sources } })).ok,
  ).toBe(true);
  const preview = await call(session, "planning.preview", { instructions: "Keep it focused" });
  expect(preview.ok).toBe(true);
  const identity = preview.state.disclosure!.identity;
  expect(preview.state.disclosure!.request.instructions).toBe("Keep it focused");
  expect((await call(session, "planning.generate", { identity })).ok).toBe(false);
  expect((await call(session, "planning.authorize", { identity })).ok).toBe(true);
  const generated = await call(session, "planning.generate", { identity });
  expect(generated.ok).toBe(true);
  return generated.state;
}

describe("local workspace session router", () => {
  test("requires a request-bound decision and explicit plan confirmation", async () => {
    const session = new SessionRouter();
    const state = await createPlan(session);
    expect(state.plan?.status).toBe("draft");
    expect(state.plan?.eligible).toBe(false);
    const identity = state.plan!.identity;
    const revision = state.plan!.revision;
    expect((await call(session, "planning.confirm", { identity, revision: revision + 1 })).ok).toBe(
      false,
    );
    const confirmed = await call(session, "planning.confirm", { identity, revision });
    expect(confirmed.state.plan?.eligible).toBe(true);
    expect(confirmed.state.execution.status).toBe("idle");
    const rejected = await call(session, "planning.reject", {});
    expect(rejected.state.plan?.status).toBe("revoked");
  });

  test("a changed model invalidates a pending disclosure and an approved plan", async () => {
    const session = new SessionRouter();
    const state = await createPlan(session);
    await call(session, "planning.confirm", {
      identity: state.plan!.identity,
      revision: state.plan!.revision,
    });
    const preview = await call(session, "planning.preview", { instructions: "adjust" });
    const old = preview.state.disclosure!.identity;
    const changed = await call(session, "model.offline", { ...offline, replacement: "different" });
    expect(changed.state.plan?.eligible).toBe(false);
    expect(changed.state.disclosure).toBeNull();
    expect((await call(session, "planning.authorize", { identity: old })).ok).toBe(false);
  });

  test("emits only validated ordered metadata and isolates listeners", async () => {
    const session = new SessionRouter();
    const events: unknown[] = [];
    session.subscribe(() => {
      throw new Error("observer must not interrupt");
    });
    const unsubscribe = session.subscribe((event) => events.push(event));
    await createPlan(session);
    unsubscribe();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => validateWorkflowSessionEvent(event).ok)).toBe(true);
    expect(validateWorkflowSessionEvents(events).ok).toBe(true);
    expect(JSON.stringify(events)).not.toContain("new text");
    expect(JSON.stringify(events)).not.toContain("Keep it focused");
    const count = events.length;
    await call(session, "planning.reject", {});
    expect(events).toHaveLength(count);
  });

  test("does not accept functions, restore capabilities, or expose host secrets", async () => {
    const secret = "a-private-api-key";
    const session = new SessionRouter({
      configuredModel: {
        endpoint: "https://example.com/v1",
        apiKey: secret,
        config: { model: "example" },
      },
    });
    const selected = await call(session, "model.configured", {});
    expect(selected.ok).toBe(true);
    expect(selected.state.model?.mode).toBe("configured");
    const invalid = await call(session, "planning.create", {
      id: "plan",
      inputs: { task, sources },
      callback: () => {},
    });
    expect(invalid.ok).toBe(false);
    expect(JSON.stringify(selected)).not.toContain(secret);
    expect(JSON.stringify(invalid)).not.toContain(secret);
    expect(
      (await call(session, "execution.authorize", { identity: "fake", decisionRef: "user" })).ok,
    ).toBe(false);
    expect((await call(session, "execution.run", {})).ok).toBe(false);
  });

  test("page configuration selects a real provider only after disclosure authorization", async () => {
    const requests: { authorization: string | null; body: unknown }[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push({
          authorization: request.headers.get("authorization"),
          body: await request.json(),
        });
        return Response.json({ choices: [{ message: { content: "Provider response" } }] });
      },
    });
    try {
      const session = new SessionRouter();
      const events: unknown[] = [];
      session.subscribe((event) => events.push(event));
      const endpoint = `http://127.0.0.1:${server.port}/v1`;
      const secret = "page-config-private-key";
      const selected = await call(session, "model.configure", {
        endpoint,
        model: "first",
        apiKey: secret,
      });
      expect(selected.ok).toBe(true);
      expect(selected.state.model?.mode).toBe("configured");
      expect(requests).toHaveLength(0);
      const messages = [{ role: "user", content: "Connection test" }];
      const preview = await call(session, "chat.preview", { messages });
      expect(preview.state.chatDisclosure?.recipient).toContain("127.0.0.1");
      const identity = preview.state.chatDisclosure!.identity;
      expect((await call(session, "chat.generate", { identity })).ok).toBe(false);
      expect(requests).toHaveLength(0);
      await call(session, "chat.authorize", { identity });
      const reply = await call(session, "chat.generate", { identity });
      expect(reply.state.chat.messages.at(-1)?.content).toBe("Provider response");
      expect(requests).toEqual([
        {
          authorization: `Bearer ${secret}`,
          body: { model: "first", messages, stream: false },
        },
      ]);
      expect(JSON.stringify([selected, preview, reply, events])).not.toContain(secret);

      expect(
        (await call(session, "model.configure", { endpoint, model: "second", apiKey: "" })).ok,
      ).toBe(true);
      const next = await call(session, "chat.preview", { messages });
      await call(session, "chat.authorize", { identity: next.state.chatDisclosure!.identity });
      const noKey = await call(session, "chat.generate", {
        identity: next.state.chatDisclosure!.identity,
      });
      expect(noKey.ok).toBe(true);
      expect(requests[1]?.authorization).toBeNull();
      expect(requests[1]?.body).toEqual({ model: "second", messages, stream: false });
      expect((await call(session, "model.configured", {})).state.model?.mode).toBe("configured");
    } finally {
      server.stop(true);
    }
  });

  test("invalid page configuration preserves the selected model and pending authority without exposing keys", async () => {
    const session = new SessionRouter();
    const endpoint = "http://127.0.0.1:1234/v1";
    const secret = "old-configuration-secret";
    expect(
      (await call(session, "model.configure", { endpoint, model: "valid", apiKey: secret })).ok,
    ).toBe(true);
    const preview = await call(session, "chat.preview", {
      messages: [{ role: "user", content: "hello" }],
    });
    const identity = preview.state.chatDisclosure!.identity;
    await call(session, "chat.authorize", { identity });
    for (const invalid of [
      { endpoint: "not a URL", model: "valid", apiKey: "new-invalid-secret" },
      { endpoint, model: "valid", apiKey: "bad\nheader" },
      { endpoint, model: "", apiKey: "new-invalid-secret" },
      { endpoint, model: "valid", apiKey: 42 },
      { endpoint, model: "new-invalid-secret", apiKey: "new-invalid-secret" },
    ]) {
      const result = await call(session, "model.configure", invalid);
      expect(result.ok).toBe(false);
      expect(result.state.chatDisclosure?.identity).toBe(identity);
      expect(result.state.chatDisclosure?.authorized).toBe(true);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain("new-invalid-secret");
    }
  });

  test("rejects historical keys in a new recipient and secret source keys before disclosure", async () => {
    const session = new SessionRouter();
    const endpoint = "http://127.0.0.1:1234/v1";
    const secret = "previous-secret-credential";
    expect(
      (await call(session, "model.configure", { endpoint, model: "one", apiKey: secret })).ok,
    ).toBe(true);
    for (const config of [
      { endpoint, model: `prefix-${secret}`, apiKey: "new-secret" },
      { endpoint: `${endpoint}/${secret}`, model: "two", apiKey: "new-secret" },
      {
        endpoint: `${endpoint}/%2570revious-secret-credential`,
        model: "two",
        apiKey: "new-secret",
      },
    ]) {
      const result = await call(session, "model.configure", config);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    const created = await call(session, "planning.create", {
      id: "plan",
      inputs: { task, sources: [{ ...sources[0], [secret]: "hidden in a property name" }] },
    });
    expect(created.ok).toBe(true);
    const preview = await call(session, "planning.preview", {});
    expect(preview.ok).toBe(false);
    expect(preview.error?.message).toBe("Credential disclosure refused");
    expect(JSON.stringify([created, preview])).not.toContain(secret);
  });

  test("checks each URL decoding stage without rejecting valid percent escapes", async () => {
    const session = new SessionRouter();
    const endpoint = "http://localhost/v1";
    expect(
      (
        await call(session, "model.configure", {
          endpoint,
          model: "safe",
          apiKey: "private-key%41",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await call(session, "model.configure", {
          endpoint: `${endpoint}/private-key%41`,
          model: "safe",
          apiKey: "next-private-key",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await call(session, "model.configure", {
          endpoint: `${endpoint}/proxy%25route`,
          model: "safe",
          apiKey: "",
        })
      ).ok,
    ).toBe(true);
  });

  test("reconfiguration revokes chat and plan authority and redacts prior credentials", async () => {
    const oldKey = "previous-private-credential";
    const newKey = "replacement-private-credential";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({ choices: [{ message: { content: `response with ${oldKey}` } }] });
      },
    });
    try {
      const endpoint = `http://127.0.0.1:${server.port}/v1`;
      const session = new SessionRouter();
      await call(session, "model.configure", { endpoint, model: "first", apiKey: oldKey });
      const preview = await call(session, "chat.preview", {
        messages: [{ role: "user", content: "hello" }],
      });
      await call(session, "chat.authorize", { identity: preview.state.chatDisclosure!.identity });
      const reply = await call(session, "chat.generate", {
        identity: preview.state.chatDisclosure!.identity,
      });
      expect(JSON.stringify(reply)).not.toContain(oldKey);
      await createPlan(session);
      const plan = (await call(session, "planning.preview", { instructions: "approve me" })).state;
      await call(session, "planning.authorize", { identity: plan.disclosure!.identity });
      const changed = await call(session, "model.configure", {
        endpoint,
        model: "second",
        apiKey: newKey,
      });
      expect(changed.ok).toBe(true);
      expect(changed.state.plan?.eligible).toBe(false);
      expect(changed.state.disclosure).toBeNull();
      expect(changed.state.chat.messages).toEqual([]);
      expect(JSON.stringify(changed)).not.toContain(oldKey);
      expect(JSON.stringify(changed)).not.toContain(newKey);
      expect(
        (await call(session, "planning.generate", { identity: plan.disclosure!.identity })).ok,
      ).toBe(false);
      expect(
        (await call(session, "chat.generate", { identity: preview.state.chatDisclosure!.identity }))
          .ok,
      ).toBe(false);
      const leaked = await call(session, "chat.preview", {
        messages: [{ role: "user", content: oldKey }],
      });
      expect(leaked.ok).toBe(false);
      expect(JSON.stringify(leaked)).not.toContain(oldKey);
    } finally {
      server.stop(true);
    }
  });

  test("reconfiguration aborts a running chat before its provider request", async () => {
    const session = new SessionRouter();
    const endpoint = "http://127.0.0.1:1234/v1";
    await call(session, "model.configure", {
      endpoint,
      model: "first",
      apiKey: "first-private-key",
    });
    const preview = await call(session, "chat.preview", {
      messages: [{ role: "user", content: "hello" }],
    });
    const identity = preview.state.chatDisclosure!.identity;
    await call(session, "chat.authorize", { identity });
    let replacement: Promise<Response> | undefined;
    const unsubscribe = session.subscribe((event) => {
      if (event && typeof event === "object" && "stage" in event && event.stage === "started")
        replacement = call(session, "model.configure", {
          endpoint,
          model: "second",
          apiKey: "second-private-key",
        });
    });
    const interrupted = await call(session, "chat.generate", { identity });
    unsubscribe();
    expect((await replacement)?.ok).toBe(true);
    expect(interrupted.ok).toBe(false);
    expect(interrupted.state.chat.status).toBe("idle");
    expect(interrupted.state.chat.messages).toEqual([]);
    expect((await call(session, "chat.generate", { identity })).ok).toBe(false);
  });

  test("configured provider is not called without disclosure and reports a transport failure", async () => {
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        calls++;
        return new Response("private provider error body", { status: 503 });
      },
    });
    try {
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          apiKey: "test-secret",
          config: { model: "local-test" },
        },
      });
      await call(session, "model.configured", {});
      await call(session, "planning.create", { id: "plan", inputs: { task, sources } });
      const preview = await call(session, "planning.preview", {});
      if (!preview.state.disclosure) throw new Error("missing disclosure preview");
      const identity = preview.state.disclosure.identity;
      expect((await call(session, "planning.generate", { identity })).ok).toBe(false);
      expect(calls).toBe(0);
      expect((await call(session, "planning.authorize", { identity })).ok).toBe(true);
      const failed = await call(session, "planning.generate", { identity });
      expect(calls).toBe(1);
      expect(failed.ok).toBe(false);
      expect(failed.error?.message).toBe("Configured model request failed");
      expect(JSON.stringify(failed)).not.toContain("test-secret");
      expect(JSON.stringify(failed)).not.toContain("private provider error body");
    } finally {
      server.stop(true);
    }
  });

  test("refuses a model whose recipient or configuration cannot be displayed without revealing its credential", async () => {
    for (const configuredModel of [
      { endpoint: "http://test.local/v1", apiKey: "test", config: { model: "safe-model" } },
      { endpoint: "http://localhost/v1", apiKey: "secret", config: { model: "secret-model" } },
      { endpoint: "http://localhost/v1", apiKey: "ab\\cd", config: { model: "prefix-ab\\cd" } },
    ]) {
      const session = new SessionRouter({ configuredModel });
      const selected = await call(session, "model.configured", {});
      expect(selected.ok).toBe(false);
      expect(selected.state.model).toBeNull();
      expect(
        (await call(session, "chat.preview", { messages: [{ role: "user", content: "hello" }] }))
          .ok,
      ).toBe(false);
      expect(JSON.stringify(selected)).not.toContain(configuredModel.apiKey);
    }
    const escaped = new SessionRouter({
      configuredModel: {
        endpoint: "http://localhost/v1",
        apiKey: "ab\\cd",
        config: { model: "safe" },
      },
    });
    expect((await call(escaped, "model.configured", {})).ok).toBe(true);
    expect(
      (await call(escaped, "chat.preview", { messages: [{ role: "user", content: "ab\\cd" }] })).ok,
    ).toBe(false);
    const encodedMessage = await call(escaped, "chat.preview", {
      messages: [{ role: "user", content: JSON.stringify({ file: "ab\\cd" }) }],
    });
    expect(encodedMessage.ok).toBe(false);
    expect(JSON.stringify(encodedMessage)).not.toContain("ab\\\\cd");
    const nestedMessage = await call(escaped, "chat.preview", {
      messages: [
        {
          role: "user",
          content: JSON.stringify({ observation: JSON.stringify({ file: "ab\\cd" }) }),
        },
      ],
    });
    expect(nestedMessage.ok).toBe(false);
    const unicodeMessage = await call(escaped, "chat.preview", {
      messages: [
        { role: "user", content: JSON.stringify({ observation: '{"token":"ab\\u005ccd"}' }) },
      ],
    });
    expect(unicodeMessage.ok).toBe(false);
    const keyName = new SessionRouter();
    const rejected = await call(keyName, "model.configure", {
      endpoint: "http://localhost/v1",
      apiKey: "model",
      model: "safe",
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.state.model).toBeNull();
    expect(rejected.error?.message).toBe("API key conflicts with the session protocol");
    const pathKey = await call(keyName, "model.configure", {
      endpoint: "http://localhost/v1",
      apiKey: "Paths",
      model: "safe",
    });
    expect(pathKey.ok).toBe(false);
    expect(pathKey.state.model).toBeNull();
  });

  test("chat requires a configured model and a fresh request-bound authorization", async () => {
    const requests: unknown[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push(await request.json());
        return Response.json({
          choices: [
            { message: { content: requests.length === 1 ? "Hello back" : "Second answer" } },
          ],
        });
      },
    });
    try {
      const secret = "chat-test-secret";
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          apiKey: secret,
          config: { model: "local-chat", temperature: 0.5 },
        },
      });
      await call(session, "model.offline", offline);
      const firstMessages = [{ role: "user", content: "Hello" }];
      const offlinePreview = await call(session, "chat.preview", { messages: firstMessages });
      expect(offlinePreview.ok).toBe(false);
      expect(offlinePreview.error?.message).toBe("Offline model does not support chat");
      await call(session, "model.configured", {});
      const first = await call(session, "chat.preview", { messages: firstMessages });
      const firstDisclosure = first.state.chatDisclosure!;
      expect(firstDisclosure.request.messages).toEqual(firstMessages);
      expect(firstDisclosure.request.config.model).toBe("local-chat");
      expect(firstDisclosure.mode).toBe("configured");
      expect(firstDisclosure.recipient).toContain("127.0.0.1");
      expect(
        (await call(session, "chat.generate", { identity: firstDisclosure.identity })).ok,
      ).toBe(false);
      expect(requests).toHaveLength(0);
      expect(
        (await call(session, "chat.authorize", { identity: firstDisclosure.identity })).ok,
      ).toBe(true);
      const changed = await call(session, "chat.preview", {
        messages: [{ role: "user", content: "Changed request" }],
      });
      expect(changed.state.chatDisclosure!.identity).not.toBe(firstDisclosure.identity);
      expect(
        (await call(session, "chat.generate", { identity: firstDisclosure.identity })).ok,
      ).toBe(false);
      expect(requests).toHaveLength(0);
      const observed: { event: unknown; state: State }[] = [];
      const unsubscribe = session.subscribe((event) => {
        observed.push({ event, state: session.snapshot() as State });
      });
      const current = await call(session, "chat.preview", { messages: firstMessages });
      const identity = current.state.chatDisclosure!.identity;
      await call(session, "chat.authorize", { identity });
      const reply = await call(session, "chat.generate", { identity });
      unsubscribe();
      expect(
        observed.map(({ state }) => ({
          sequence: state.sequence,
          authorized: state.chatDisclosure?.authorized ?? null,
          status: state.chat.status,
        })),
      ).toEqual([
        { sequence: current.state.sequence, authorized: false, status: "idle" },
        { sequence: current.state.sequence + 1, authorized: true, status: "idle" },
        { sequence: current.state.sequence + 2, authorized: null, status: "running" },
        { sequence: current.state.sequence + 3, authorized: null, status: "completed" },
      ]);
      expect(validateWorkflowSessionEvents(observed.map(({ event }) => event)).ok).toBe(true);
      expect(reply.ok).toBe(true);
      expect(reply.state.chat).toEqual({
        messages: [...firstMessages, { role: "assistant", content: "Hello back" }],
        status: "completed",
      });
      expect((await call(session, "chat.generate", { identity })).ok).toBe(false);
      const secondMessages = [...reply.state.chat.messages, { role: "user", content: "Continue" }];
      const second = await call(session, "chat.preview", { messages: secondMessages });
      await call(session, "chat.authorize", { identity: second.state.chatDisclosure!.identity });
      const continued = await call(session, "chat.generate", {
        identity: second.state.chatDisclosure!.identity,
      });
      expect(continued.state.chat.messages).toEqual([
        ...secondMessages,
        { role: "assistant", content: "Second answer" },
      ]);
      expect(requests).toEqual([
        { model: "local-chat", messages: firstMessages, stream: false, temperature: 0.5 },
        { model: "local-chat", messages: secondMessages, stream: false, temperature: 0.5 },
      ]);
      expect(JSON.stringify(continued)).not.toContain(secret);
      const sensitive = await call(session, "chat.preview", {
        messages: [{ role: "user", content: `Do not send ${secret}` }],
      });
      expect(sensitive.ok).toBe(false);
      expect(JSON.stringify(sensitive)).not.toContain(secret);
      expect(requests).toHaveLength(2);
    } finally {
      server.stop(true);
    }
  });

  test("chat failure and reentrant cancellation publish state without sending a cancelled request", async () => {
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        calls++;
        return new Response("private failure", { status: 503 });
      },
    });
    try {
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          config: { model: "local-chat" },
        },
      });
      await call(session, "model.configured", {});
      const messages = [{ role: "user", content: "Hello" }];
      const snapshots: State[] = [];
      const unsubscribe = session.subscribe(() => snapshots.push(session.snapshot() as State));
      const preview = await call(session, "chat.preview", { messages });
      const identity = preview.state.chatDisclosure!.identity;
      await call(session, "chat.authorize", { identity });
      const failed = await call(session, "chat.generate", { identity });
      expect(failed.ok).toBe(false);
      expect(failed.state.chat.status).toBe("failed");
      expect(snapshots.map((state) => state.chat.status)).toEqual([
        "idle",
        "idle",
        "running",
        "failed",
      ]);
      expect(snapshots.map((state) => state.sequence)).toEqual([
        preview.state.sequence,
        preview.state.sequence + 1,
        preview.state.sequence + 2,
        preview.state.sequence + 3,
      ]);
      const next = await call(session, "chat.preview", { messages });
      await call(session, "chat.authorize", { identity: next.state.chatDisclosure!.identity });
      const stopOnStart = session.subscribe((event) => {
        if (event && typeof event === "object" && "stage" in event && event.stage === "started")
          void session.dispatch("chat.cancel", {});
      });
      const cancelled = await call(session, "chat.generate", {
        identity: next.state.chatDisclosure!.identity,
      });
      stopOnStart();
      unsubscribe();
      expect(cancelled.ok).toBe(false);
      expect(cancelled.error?.message).toBe("Chat was superseded");
      expect(cancelled.state.chat.status).toBe("idle");
      expect(snapshots.slice(-2).map((state) => state.chat.status)).toEqual(["running", "idle"]);
      expect(snapshots.at(-1)!.sequence).toBe(snapshots.at(-2)!.sequence + 1);
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("chat authorization is invalidated by model and plan changes", async () => {
    const session = new SessionRouter({
      configuredModel: { endpoint: "https://example.com/v1", config: { model: "example" } },
    });
    await call(session, "model.configured", {});
    const messages = [{ role: "user", content: "Hello" }];
    const preview = await call(session, "chat.preview", { messages });
    const identity = preview.state.chatDisclosure!.identity;
    await call(session, "chat.authorize", { identity });
    await call(session, "model.configured", {});
    expect((await call(session, "chat.generate", { identity })).ok).toBe(false);
    const next = await call(session, "chat.preview", { messages });
    const nextIdentity = next.state.chatDisclosure!.identity;
    await call(session, "chat.authorize", { identity: nextIdentity });
    const created = await call(session, "planning.create", {
      id: "plan",
      inputs: { task, sources },
    });
    expect(created.state.chatDisclosure).toBeNull();
    expect((await call(session, "chat.generate", { identity: nextIdentity })).ok).toBe(false);
  });

  test("a superseded chat cannot overwrite the current conversation", async () => {
    const requestStarted = Promise.withResolvers<void>();
    const responseReleased = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        requestStarted.resolve();
        await responseReleased.promise;
        return Response.json({ choices: [{ message: { content: "Stale reply" } }] });
      },
    });
    try {
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          config: { model: "local-chat" },
        },
      });
      await call(session, "model.configured", {});
      const preview = await call(session, "chat.preview", {
        messages: [{ role: "user", content: "First" }],
      });
      const identity = preview.state.chatDisclosure!.identity;
      await call(session, "chat.authorize", { identity });
      const generating = call(session, "chat.generate", { identity });
      await requestStarted.promise;
      const replacement = await call(session, "chat.preview", {
        messages: [{ role: "user", content: "Second" }],
      });
      responseReleased.resolve();
      const stale = await generating;
      expect(stale.ok).toBe(false);
      expect(stale.state.chat.status).toBe("idle");
      expect(stale.state.chat.messages).toEqual([]);
      expect(stale.state.chatDisclosure?.identity).toBe(replacement.state.chatDisclosure?.identity);
    } finally {
      responseReleased.resolve();
      server.stop(true);
    }
  });

  test.each([false, true])(
    "evaluation gates requests and supports planning (partial: %s)",
    async (partial) => {
      const requests: unknown[] = [];
      let evaluationReport: CodeEvaluationReport | null = null;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const body = (await request.json()) as { messages: { role: string; content: string }[] };
          requests.push(body);
          const user = body.messages.find((message) => message.role === "user")?.content ?? "";
          let response: unknown;
          if (body.messages[0]?.content.includes("You prepare")) {
            response = {
              task: "inspect",
              focus: [],
              standards: ["behavior"],
              requirements: [],
              excluded: ["boundaries", "security", "concurrency", "performance", "maintenance"].map(
                (id) => ({
                  id,
                  reason: "This test examines only visible behavior.",
                }),
              ),
              reads: [],
            };
          } else if (!evaluationReport) {
            const marker = "Untrusted review context:\n";
            const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)) as {
              sources: { id: string; role: string; startLine: number }[];
            };
            const item = context.sources.find((entry) => entry.role === "target");
            if (!item) throw new Error("Missing target evidence");
            const criteria = [...user.matchAll(/^Criterion ([^ ]+) \((quality|contract),/gm)];
            const criterion = criteria[0]?.[1];
            response = {
              schema: "lorelum.judge.review-result/v2",
              verdicts: criteria.map((entry) => ({
                schema: "lorelum.judge.verdict/v1",
                criterionId: entry[1],
                verdict: "weak",
                evidenceIds: [item.id],
                rationale: "The visible function returns its input.",
              })),
              summary: [
                {
                  text: "The function returns all items.",
                  criterionIds: [criterion],
                  problemIds: ["limit"],
                  evidenceIds: [item.id],
                },
              ],
              problems: [
                {
                  id: "limit",
                  criterionId: criterion,
                  title: "Unbounded result",
                  severity: "medium",
                  condition: "Large input",
                  impact: "Large output",
                  rationale: "The array is returned directly.",
                  evidenceIds: [item.id],
                  locations: [
                    { itemId: item.id, startLine: item.startLine, endLine: item.startLine },
                  ],
                  attribution: "not_applicable",
                },
              ],
              pending: partial
                ? [
                    {
                      id: "pending-1",
                      criterionId: criterion,
                      question: "What is the intended limit?",
                      reason: "The target does not specify one.",
                      evidenceIds: [item.id],
                    },
                  ]
                : [],
              followUps: [],
            };
          } else {
            const problem = evaluationReport.result?.problems[0];
            if (!problem) throw new Error("Missing evaluated problem");
            response = {
              schema: "lorelum.judge.code-suggestion-result/v1",
              suggestions: [
                {
                  id: "suggestion-1",
                  problemId: problem.id,
                  evidenceIds: problem.evidenceIds,
                  location: problem.locations[0],
                  category: "required",
                  problem: "Unbounded result",
                  priorityRationale: "Large output",
                  direction: "Consider a limit",
                  impact: "Less output",
                  checks: ["Check large input"],
                  uncertainPremises: [],
                  alternatives: [],
                },
              ],
              omissions: [],
            };
          }
          return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
        },
      });
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          apiKey: "review-test-private-key",
          config: { model: "review-model" },
        },
      });
      const next = (predicate: (state: State) => boolean): Promise<State> => {
        const current = session.snapshot() as State;
        if (predicate(current)) return Promise.resolve(current);
        const { promise, resolve } = Promise.withResolvers<State>();
        const unsubscribe = session.subscribe(() => {
          const state = session.snapshot() as State;
          if (predicate(state)) {
            unsubscribe();
            resolve(state);
          }
        });
        return promise;
      };
      try {
        await call(session, "model.configured", {});
        const noEvaluation = await call(session, "planning.fromEvaluation", {
          id: "plan",
          text: "Fix the reported issues",
        });
        expect(noEvaluation.ok).toBe(false);
        expect(noEvaluation.error?.message).toBe("A usable evaluation is required for planning");
        expect((await call(session, "suggestions.start", {})).ok).toBe(false);
        expect(
          (
            await call(session, "evaluation.start", {
              target: { kind: "snippet", text: "function list(items) { return items; }" },
            })
          ).ok,
        ).toBe(true);
        let state = await next((value) => value.executionDisclosure !== null);
        const first = state.executionDisclosure!;
        expect(first.recipient).toContain("127.0.0.1");
        expect(first.request.config.model).toBe("review-model");
        expect(JSON.stringify(first.request.messages)).toContain("function list");
        expect(requests).toHaveLength(0);
        expect((await call(session, "execution.disclosure.allow", { identity: "wrong" })).ok).toBe(
          false,
        );
        await call(session, "execution.disclosure.allow", { identity: first.identity });
        state = await next(
          (value) =>
            value.executionDisclosure !== null &&
            value.executionDisclosure.identity !== first.identity,
        );
        expect(requests).toHaveLength(1);
        expect(
          (await call(session, "execution.disclosure.allow", { identity: first.identity })).ok,
        ).toBe(false);
        await call(session, "execution.disclosure.allow", {
          identity: state.executionDisclosure!.identity,
        });
        state = await next((value) => value.evaluation.status !== "running");
        expect(["completed", "partial"]).toContain(state.evaluation.status);
        expect(state.evaluation.report?.result?.problems).toHaveLength(1);
        evaluationReport = state.evaluation.report;
        if (partial) expect(state.evaluation.status).toBe("partial");
        const missingWorkspace = await call(session, "planning.fromEvaluation", {
          id: "missing-workspace",
          text: "Fix the issues",
          paths: ["not-discovered.ts"],
        });
        expect(missingWorkspace.ok).toBe(false);
        expect(missingWorkspace.error?.message).toBe("Invalid selected project paths");
        const created = await call(session, "planning.fromEvaluation", {
          id: "review-plan",
          text: "Fix the reported issues",
          conversation: '[{"role":"user","content":"Preserve result ordering"}]',
          materials: "The maximum is 20 items.",
        });
        expect(created.ok).toBe(true);
        expect(created.state.disclosure).toBeNull();
        expect(requests).toHaveLength(2);
        const preview = await call(session, "planning.preview", {});
        expect(preview.ok).toBe(true);
        expect(preview.state.disclosure?.authorized).toBe(false);
        expect(preview.state.disclosure?.request.task.text).toBe("Fix the reported issues");
        expect(
          preview.state.disclosure!.request.sources.find((source) => source.id === "conversation")
            ?.content,
        ).toContain("Preserve result ordering");
        expect(
          preview.state.disclosure!.request.sources.find((source) => source.id === "material")
            ?.content,
        ).toBe("The maximum is 20 items.");
        const reference = preview.state.disclosure!.request.sources.find(
          (source) => source.kind === "reference",
        )!;
        expect(reference.kind).toBe("reference");
        expect(reference.locator).toBe(`evaluation:${evaluationReport!.id}`);
        expect(reference.version).toBe(evaluationReport!.sourceIdentity);
        expect(JSON.parse(reference.content)).toEqual({
          status: evaluationReport!.status,
          request: evaluationReport!.request,
          source: evaluationReport!.source,
          result: evaluationReport!.result,
          issues: evaluationReport!.issues,
          limitations: evaluationReport!.limitations,
        });
        expect(requests).toHaveLength(2);
        expect(state.evaluation.text).toBeTruthy();
        const startedSuggestions = await call(session, "suggestions.start", {});
        expect(startedSuggestions.state.plan).toBeNull();
        expect(startedSuggestions.state.disclosure).toBeNull();
        expect(
          (
            await call(session, "planning.authorize", {
              identity: preview.state.disclosure!.identity,
            })
          ).ok,
        ).toBe(false);
        state = await next((value) => value.executionDisclosure !== null);
        expect(requests).toHaveLength(2);
        expect(JSON.stringify(state.executionDisclosure!.request.messages)).toContain("limit");
        await call(session, "execution.disclosure.allow", {
          identity: state.executionDisclosure!.identity,
        });
        state = await next((value) => value.suggestions.status !== "running");
        expect(["completed", "partial"]).toContain(state.suggestions.status);
        expect(state.suggestions.report?.evaluationIdentity).toBeTruthy();
        expect(
          (
            await call(session, "planning.fromEvaluation", {
              id: "with-advice",
              text: "按建议修复",
            })
          ).ok,
        ).toBe(true);
        const advicePreview = await call(session, "planning.preview", {});
        const adviceSource = advicePreview.state.disclosure!.request.sources.find(
          (source) => source.id === "suggestions",
        );
        expect(adviceSource?.kind).toBe("reference");
        expect(JSON.parse(adviceSource!.content).result).toEqual(state.suggestions.report?.result);
        expect(requests).toHaveLength(3);
        const restarted = await call(session, "evaluation.start", {
          target: { kind: "snippet", text: "function updated() {}" },
        });
        expect(restarted.state.plan).toBeNull();
        expect(restarted.state.disclosure).toBeNull();
        expect(
          (
            await call(session, "planning.authorize", {
              identity: advicePreview.state.disclosure!.identity,
            })
          ).ok,
        ).toBe(false);
        await call(session, "evaluation.cancel", {});
        expect(JSON.stringify(state)).not.toContain("review-test-private-key");
      } finally {
        server.stop(true);
      }
    },
  );

  test("review cancellation revokes the pending request and stale approvals", async () => {
    const session = new SessionRouter({
      configuredModel: {
        endpoint: "http://127.0.0.1:1/v1",
        config: { model: "review-model" },
      },
    });
    await call(session, "model.configured", {});
    const pending = Promise.withResolvers<void>();
    const unsubscribe = session.subscribe(() => {
      if ((session.snapshot() as State).executionDisclosure) pending.resolve();
    });
    await call(session, "evaluation.start", { target: { kind: "snippet", text: "const x = 1;" } });
    await pending.promise;
    const identity = (session.snapshot() as State).executionDisclosure!.identity;
    expect((await call(session, "evaluation.cancel", {})).state.evaluation.status).toBe(
      "cancelled",
    );
    expect((await call(session, "execution.disclosure.allow", { identity })).ok).toBe(false);
    expect((session.snapshot() as State).executionDisclosure).toBeNull();
    unsubscribe();
  });
  test("denying review disclosure produces a real failed report without sending", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return new Response("must not be sent");
      },
    });
    try {
      const session = new SessionRouter({
        configuredModel: {
          endpoint: `http://127.0.0.1:${server.port}/v1`,
          config: { model: "review-model" },
        },
      });
      await call(session, "model.configured", {});
      const proposed = Promise.withResolvers<void>();
      const finished = Promise.withResolvers<void>();
      const unsubscribe = session.subscribe(() => {
        const state = session.snapshot() as State;
        if (state.executionDisclosure) proposed.resolve();
        if (state.evaluation.status === "failed") finished.resolve();
      });
      await call(session, "evaluation.start", {
        target: { kind: "snippet", text: "const x = 1;" },
      });
      await proposed.promise;
      const state = session.snapshot() as State;
      await call(session, "execution.disclosure.deny", {
        identity: state.executionDisclosure!.identity,
      });
      await finished.promise;
      const result = session.snapshot() as State;
      expect(result.evaluation.report?.status).toBe("failed");
      const planning = await call(session, "planning.fromEvaluation", {
        id: "plan",
        text: "Fix the issues",
      });
      expect(planning.ok).toBe(false);
      expect(planning.error?.message).toBe("A usable evaluation is required for planning");
      expect(requests).toBe(0);
      unsubscribe();
    } finally {
      server.stop(true);
    }
  });

  test("binds selected planning paths to the discovered workspace and rejects excluded paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "planning-paths-"));
    const session = new SessionRouter();
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      await writeFile(join(root, "note.txt"), "public");
      await writeFile(join(root, "secret.txt"), "excluded");
      execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
      execFileSync("git", ["add", "note.txt"], { cwd: root });
      execFileSync("git", ["commit", "-m", "base"], { cwd: root, stdio: "ignore" });
      expect(
        (
          await call(session, "workspace.discover", {
            root,
            exclusions: [{ path: "secret.txt", reason: "private" }],
          })
        ).ok,
      ).toBe(true);
      await call(session, "model.offline", offline);
      const workspace = session.snapshot() as {
        workspace: { identity: string; candidates: { path: string; contentIdentity: string }[] };
      };
      const invalid = await call(session, "planning.create", {
        id: "invalid",
        inputs: { task, sources },
        paths: ["secret.txt"],
        workspaceIdentity: workspace.workspace.identity,
      });
      expect(invalid.ok).toBe(false);
      expect(invalid.error?.message).toBe("Invalid selected project paths");
      expect(
        (
          await call(session, "planning.create", {
            id: "valid",
            inputs: { task, sources },
            paths: ["note.txt"],
            workspaceIdentity: workspace.workspace.identity,
          })
        ).ok,
      ).toBe(true);
      const preview = await call(session, "planning.preview", {});
      const selected = preview.state.disclosure!.request.sources.find(
        (source) => source.id === "project-paths",
      )!;
      expect(selected.version).toBe(workspace.workspace.identity);
      expect(JSON.parse(selected.content).paths).toEqual([
        {
          path: "note.txt",
          contentIdentity: workspace.workspace.candidates.find((item) => item.path === "note.txt")!
            .contentIdentity,
        },
      ]);
      const wrongWorkspace = await call(session, "planning.create", {
        id: "wrong-workspace",
        inputs: { task, sources },
        paths: ["note.txt"],
        workspaceIdentity: "stale",
      });
      expect(wrongWorkspace.ok).toBe(false);
      await writeFile(join(root, "note.txt"), "changed");
      const rediscovered = await call(session, "workspace.discover", {
        root,
        exclusions: [{ path: "secret.txt", reason: "private" }],
      });
      expect(rediscovered.ok).toBe(true);
      expect(rediscovered.state.plan).toBeNull();
      expect(
        (
          await call(session, "planning.authorize", {
            identity: preview.state.disclosure!.identity,
          })
        ).ok,
      ).toBe(false);
      const staleSelection = await call(session, "planning.create", {
        id: "stale",
        inputs: { task, sources },
        paths: ["note.txt"],
        workspaceIdentity: workspace.workspace.identity,
      });
      expect(staleSelection.ok).toBe(false);
    } finally {
      await call(session, "workspace.discover", { root: "relative", exclusions: [] });
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Windows drive paths are rejected clearly outside WSL", async () => {
    if (process.platform === "linux" && /microsoft/i.test(release())) return;
    const session = new SessionRouter();
    const result = await call(session, "workspace.discover", {
      root: "C:\\project",
      exclusions: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("Windows paths require WSL and wslpath");
    expect((session.snapshot() as { workspace: unknown }).workspace).toBeNull();
  });

  test("returns safe discovery diagnostics without creating a fake workspace", async () => {
    const session = new SessionRouter();
    const result = await call(session, "workspace.discover", { root: "relative", exclusions: [] });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("Project root must be absolute");
    expect((session.snapshot() as { workspace: unknown }).workspace).toBeNull();
  });
});

const linux = process.platform === "linux" ? describe : describe.skip;
linux("real workspace authorization", () => {
  test("configured execution requires a fresh decision for each provider request", async () => {
    let providerCalls = 0;
    let planningMessages: unknown;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        providerCalls++;
        const body = await request.json();
        if (body.messages.length === 2 && body.messages[0].role === "system") {
          planningMessages = body.messages;
          const input = JSON.parse(body.messages[1].content);
          const acceptance = [
            {
              id: "replace",
              text: "Update the note",
              source: { origin: "user", ref: "request" },
            },
          ];
          const plan = {
            schema: "workflow-plan/v1",
            id: input.id,
            revision: input.revision,
            task: { ...input.task, acceptance },
            sources: input.sources,
            goal: "Update the note",
            scope: ["note.txt"],
            steps: [{ id: "replace", description: "Update the note", acceptanceIds: ["replace"] }],
            checks: [{ id: "check", description: "Run the check", acceptanceIds: ["replace"] }],
            nonGoals: ["Publish changes"],
            missing: [],
            conflicts: [],
          };
          return Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] });
        }
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ type: "read", path: "note.txt" }) } }],
        });
      },
    });
    try {
      for (const decision of ["deny", "cancel", "expire", "allow"] as const) {
        const root = await mkdtemp(join(tmpdir(), "execution-disclosure-"));
        const session = new SessionRouter();
        try {
          const git = (...args: string[]) =>
            execFileSync("git", args, { cwd: root, stdio: "ignore" });
          git("init");
          git("config", "user.email", "test@example.invalid");
          git("config", "user.name", "Test");
          await writeFile(join(root, "note.txt"), "base");
          git("add", "note.txt");
          git("commit", "-m", "base");
          expect((await call(session, "workspace.discover", { root, exclusions: [] })).ok).toBe(
            true,
          );
          const workspace = session.snapshot() as { workspace: { identity: string } };
          const endpoint = `http://127.0.0.1:${server.port}/v1`;
          const configured = await call(session, "model.configure", {
            endpoint,
            model: "local-model",
            apiKey: "execution-secret",
          });
          expect(configured.ok).toBe(true);
          await call(session, "planning.create", { id: "plan", inputs: { task, sources } });
          const preview = await call(session, "planning.preview", {});
          const planDisclosure = preview.state.disclosure!.identity;
          await call(session, "planning.authorize", { identity: planDisclosure });
          const generated = await call(session, "planning.generate", { identity: planDisclosure });
          expect(generated.ok).toBe(true);
          expect(planningMessages).toEqual(preview.state.disclosure!.request.messages);
          await call(session, "planning.confirm", {
            identity: generated.state.plan!.identity,
            revision: generated.state.plan!.revision,
          });
          const command = { executable: "/usr/bin/true", args: [], cwd: "." };
          const proposed = await call(session, "execution.propose", {
            permission: {
              planIdentity: generated.state.plan!.identity,
              planRevision: generated.state.plan!.revision,
              workspaceIdentity: workspace.workspace.identity,
              readPaths: ["note.txt"],
              commandReadPaths: ["."],
              writePaths: ["note.txt"],
              writablePaths: [],
              commands: [command],
              disclosures: ["plan", "file-content", "command-output", "review"],
              modelRecipient: configured.state.model!.recipient,
              limits: {
                totalTimeMs: 30000,
                commandTimeMs: 15000,
                modelCalls: 4,
                actions: 4,
                commands: 1,
                outputBytes: 10000,
              },
              expiresAt: Date.now() + (decision === "expire" ? 1000 : 30000),
              isolation: "bubblewrap-no-network",
            },
            verification: {
              checks: [
                {
                  id: "check",
                  version: "1",
                  environmentIdentity: null,
                  ...command,
                  readPaths: ["."],
                  timeoutMs: 15000,
                  maxOutputBytes: 1000,
                },
              ],
            },
          });
          expect(proposed.ok).toBe(true);
          const proposal = proposed.state.execution.proposal as { identity: string };
          expect(
            (
              await call(session, "execution.authorize", {
                identity: proposal.identity,
                decisionRef: "user-approved",
              })
            ).ok,
          ).toBe(true);
          const baseline = providerCalls;
          const seen: string[] = [];
          const observations: {
            recipient: string;
            messages: unknown[];
            model: string;
            calls: number;
            raw: string;
          }[] = [];
          const unsubscribe = session.subscribe((event) => {
            if (
              !event ||
              typeof event !== "object" ||
              !("stage" in event) ||
              event.stage !== "proposed"
            )
              return;
            const state = session.snapshot() as {
              executionDisclosure: {
                identity: string;
                recipient: string;
                request: { messages: unknown[]; config: { model: string } };
              } | null;
            };
            const disclosure = state.executionDisclosure;
            if (!disclosure) return;
            observations.push({
              recipient: disclosure.recipient,
              messages: disclosure.request.messages,
              model: disclosure.request.config.model,
              calls: providerCalls,
              raw: JSON.stringify(disclosure),
            });
            seen.push(disclosure.identity);
            if (decision === "cancel") void call(session, "execution.cancel", {});
            else if (decision === "deny" || (decision === "allow" && seen.length > 1))
              void call(session, "execution.disclosure.deny", { identity: disclosure.identity });
            else if (decision === "allow")
              void call(session, "execution.disclosure.allow", { identity: disclosure.identity });
          });
          await call(session, "execution.run", {});
          unsubscribe();
          expect(seen.length).toBeGreaterThan(0);
          if (decision === "allow") expect(seen).toHaveLength(2);
          for (const [index, observed] of observations.entries()) {
            expect(observed.recipient).toContain("127.0.0.1");
            expect(observed.messages.length).toBeGreaterThan(0);
            expect(observed.model).toBe("local-model");
            expect(observed.raw).not.toContain("execution-secret");
            expect(observed.calls).toBe(baseline + (decision === "allow" ? index : 0));
          }
          expect(providerCalls - baseline).toBe(decision === "allow" ? 1 : 0);
          expect(
            (await call(session, "execution.disclosure.allow", { identity: seen[0] })).ok,
          ).toBe(false);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    } finally {
      server.stop(true);
    }
  }, 60000);

  test("discovers dirty/untracked files, excludes before review, and revokes a separate execution decision", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-session-"));
    const session = new SessionRouter();
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      await writeFile(join(root, "note.txt"), "base");
      git("add", "note.txt");
      git("commit", "-m", "base");
      await writeFile(join(root, "note.txt"), "dirty");
      await writeFile(join(root, "secret.txt"), "private");
      const discovery = await call(session, "workspace.discover", {
        root,
        exclusions: [{ path: "secret.txt", reason: "private" }],
      });
      expect(discovery.ok).toBe(true);
      const workspace = (
        session.snapshot() as {
          workspace: {
            identity: string;
            candidates: { path: string; origin: string; status: string }[];
          };
        }
      ).workspace;
      expect(workspace.candidates.find((item) => item.path === "note.txt")?.origin).toBe(
        "modified",
      );
      expect(workspace.candidates.find((item) => item.path === "secret.txt")?.status).toBe(
        "excluded",
      );
      const plan = await createPlan(session);
      await call(session, "planning.confirm", {
        identity: plan.plan!.identity,
        revision: plan.plan!.revision,
      });
      const command = { executable: "/usr/bin/true", args: [], cwd: "." };
      const proposalInput = {
        permission: {
          planIdentity: plan.plan!.identity,
          planRevision: plan.plan!.revision,
          workspaceIdentity: workspace.identity,
          readPaths: ["note.txt"],
          commandReadPaths: ["."],
          writePaths: ["note.txt"],
          writablePaths: [],
          commands: [command],
          disclosures: ["plan", "file-content", "command-output", "review"],
          modelRecipient: "offline (local deterministic model)",
          limits: {
            totalTimeMs: 30000,
            commandTimeMs: 15000,
            modelCalls: 4,
            actions: 4,
            commands: 1,
            outputBytes: 10000,
          },
          expiresAt: Date.now() + 30000,
          isolation: "bubblewrap-no-network",
        },
        verification: {
          checks: [
            {
              id: "check",
              version: "1",
              environmentIdentity: null,
              ...command,
              readPaths: ["."],
              timeoutMs: 15000,
              maxOutputBytes: 1000,
            },
          ],
        },
      };
      const proposal = await call(session, "execution.propose", proposalInput);
      expect(proposal.ok).toBe(true);
      const proposed = proposal.state.execution.proposal as { identity: string };
      expect((await call(session, "execution.run", {})).ok).toBe(false);
      expect(
        (
          await call(session, "execution.authorize", {
            identity: proposed.identity,
            decisionRef: "user-approved",
          })
        ).state.execution.status,
      ).toBe("authorized");
      const reconfigured = await call(session, "model.configure", {
        endpoint: "http://127.0.0.1:1234/v1",
        model: "new-model",
        apiKey: "execution-replacement-key",
      });
      expect(reconfigured.ok).toBe(true);
      expect(reconfigured.state.execution.status).toBe("idle");
      expect(reconfigured.state.execution.proposal).toBeNull();
      expect(reconfigured.state.plan?.eligible).toBe(false);
      expect((await call(session, "execution.run", {})).ok).toBe(false);
      const restored = await createPlan(session);
      await call(session, "planning.confirm", {
        identity: restored.plan!.identity,
        revision: restored.plan!.revision,
      });
      proposalInput.permission.planIdentity = restored.plan!.identity;
      proposalInput.permission.planRevision = restored.plan!.revision;
      const restoredProposal = await call(session, "execution.propose", proposalInput);
      const restoredIdentity = restoredProposal.state.execution.proposal as { identity: string };
      expect(
        (
          await call(session, "execution.authorize", {
            identity: restoredIdentity.identity,
            decisionRef: "restored-approval",
          })
        ).ok,
      ).toBe(true);
      expect((await call(session, "execution.cancel", {})).state.execution.status).toBe(
        "cancelled",
      );
      expect((await call(session, "execution.run", {})).ok).toBe(false);
      const second = await call(session, "execution.propose", proposalInput);
      const nextProposal = second.state.execution.proposal as { identity: string };
      expect(
        (
          await call(session, "execution.authorize", {
            identity: nextProposal.identity,
            decisionRef: "second-approval",
          })
        ).ok,
      ).toBe(true);
      type CompletedState = {
        sequence: number;
        execution: {
          status: string;
          result: { workspaceRoot: string | null; report: { checks: string } };
        };
      };
      let terminalSnapshot: CompletedState | undefined;
      session.subscribe((event) => {
        if (event && typeof event === "object" && "stage" in event && event.stage === "terminal")
          terminalSnapshot = session.snapshot() as CompletedState;
      });
      const completed = await call(session, "execution.run", {});
      const final = completed.state as unknown as CompletedState;
      expect(final.execution.status).toBe("completed");
      expect(final.execution.result.report.checks).toBe("complete");
      expect(terminalSnapshot?.sequence).toBe(final.sequence);
      expect(terminalSnapshot?.execution.result.report.checks).toBe("complete");
      expect(terminalSnapshot?.execution.status).toBe("completed");
      if (final.execution.result.workspaceRoot)
        await rm(final.execution.result.workspaceRoot, { recursive: true, force: true });
      const refreshed = await call(session, "workspace.discover", {
        root,
        exclusions: [{ path: "secret.txt", reason: "private" }],
      });
      expect(refreshed.ok).toBe(true);
      const refreshedWorkspace = (session.snapshot() as { workspace: { identity: string } })
        .workspace;
      const refreshedPlan = await createPlan(session);
      if (!refreshedPlan.plan) throw new Error("missing refreshed plan");
      await call(session, "planning.confirm", {
        identity: refreshedPlan.plan.identity,
        revision: refreshedPlan.plan.revision,
      });
      const stoppedProposal = await call(session, "execution.propose", {
        ...proposalInput,
        permission: {
          ...proposalInput.permission,
          planIdentity: refreshedPlan.plan.identity,
          planRevision: refreshedPlan.plan.revision,
          workspaceIdentity: refreshedWorkspace.identity,
          expiresAt: Date.now() + 30000,
        },
      });
      const stopIdentity = stoppedProposal.state.execution.proposal as { identity: string };
      expect(
        (
          await call(session, "execution.authorize", {
            identity: stopIdentity.identity,
            decisionRef: "stop-after-check",
          })
        ).ok,
      ).toBe(true);
      const unsubscribe = session.subscribe((event) => {
        if (
          event &&
          typeof event === "object" &&
          "stage" in event &&
          "status" in event &&
          event.stage === "check" &&
          event.status === "passed"
        )
          void call(session, "execution.cancel", {});
      });
      const stopped = (await call(session, "execution.run", {})).state as unknown as CompletedState;
      unsubscribe();
      expect(stopped.execution.status).toBe("cancelled");
      expect(stopped.execution.result.report.checks).toBe("complete");
      if (stopped.execution.result.workspaceRoot)
        await rm(stopped.execution.result.workspaceRoot, { recursive: true, force: true });
      expect(await readFile(join(root, "note.txt"), "utf8")).toBe("dirty");
      expect(await readFile(join(root, "secret.txt"), "utf8")).toBe("private");
    } finally {
      await call(session, "workspace.discover", { root: "relative", exclusions: [] });
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
