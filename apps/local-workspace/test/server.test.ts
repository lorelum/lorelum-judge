import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceServer, type WorkspaceSession } from "../src/server.js";

function fixture() {
  const listeners = new Set<(event: unknown) => void>();
  const actions: { action: string; payload: unknown }[] = [];
  const disconnected = Promise.withResolvers<void>();
  const session: WorkspaceSession = {
    snapshot: () => ({ phase: "idle" }),
    async dispatch(action, payload) {
      actions.push({ action, payload });
      if (action === "error") throw new Error("secret must not escape");
      return { accepted: true };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        disconnected.resolve();
      };
    },
  };
  return { session, listeners, actions, disconnected: disconnected.promise };
}

const client = { "X-Local-Workspace": "1" };

async function bootstrap(url: string) {
  const response = await fetch(`${url}/api/bootstrap`, { headers: client });
  expect(response.status).toBe(200);
  return (await response.json()) as { token: string; state: { phase: string } };
}

describe("local workspace HTTP boundary", () => {
  test("requires exact host and rejects cross-origin and cross-site requests without CORS", async () => {
    const { session, actions } = fixture();
    const server = createWorkspaceServer({ session });
    try {
      const foreign = await fetch(`${server.url}/api/bootstrap`, {
        headers: { ...client, Origin: "https://evil.example" },
      });
      expect(foreign.status).toBe(403);
      expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
      expect(
        (await fetch(`${server.url}/api/bootstrap`, { headers: { ...client, Origin: "null" } }))
          .status,
      ).toBe(403);
      expect(
        (
          await fetch(`${server.url}/api/bootstrap`, {
            headers: { ...client, "Sec-Fetch-Site": "cross-site" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${server.url}/api/bootstrap`, {
            headers: { ...client, Host: `localhost:${server.port}` },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${server.url}/api/bootstrap`, {
            headers: { ...client, Host: `127.0.0.1:${server.port}.evil.example` },
          })
        ).status,
      ).toBe(403);
      expect((await fetch(`${server.url}/api/bootstrap`)).status).toBe(403);
      const preflight = await fetch(`${server.url}/api/action/approve`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "x-csrf-token,content-type",
        },
      });
      expect(preflight.status).toBe(403);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(actions).toEqual([]);
    } finally {
      server.stop();
    }
  });

  test("protects snapshots, events and JSON actions with the per-server token", async () => {
    const { session, actions } = fixture();
    const server = createWorkspaceServer({ session });
    const other = createWorkspaceServer({ session });
    try {
      const boot = await bootstrap(server.url);
      const otherBoot = await bootstrap(other.url);
      expect(boot.state).toEqual({ phase: "idle" });
      expect(boot.token).toMatch(/^[0-9a-f]{64}$/);
      expect(otherBoot.token).not.toBe(boot.token);
      for (const path of ["state", "events"]) {
        expect((await fetch(`${server.url}/api/${path}`, { headers: client })).status).toBe(403);
        expect(
          (
            await fetch(`${server.url}/api/${path}`, {
              headers: { ...client, "X-CSRF-Token": otherBoot.token },
            })
          ).status,
        ).toBe(403);
      }
      const headers = { ...client, "X-CSRF-Token": boot.token };
      const state = await fetch(`${server.url}/api/state`, { headers });
      expect(await state.json()).toEqual({ state: { phase: "idle" } });
      expect(state.headers.get("cache-control")).toBe("no-store");
      const action = `${server.url}/api/action/planning.confirm`;
      expect(
        (
          await fetch(action, {
            method: "POST",
            headers: { ...client, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(action, {
            method: "POST",
            headers: { ...headers, "Content-Type": "text/plain" },
            body: "{}",
          })
        ).status,
      ).toBe(415);
      expect(
        (
          await fetch(action, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(action, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify("x".repeat(256 * 1024)),
          })
        ).status,
      ).toBe(413);
      const result = await fetch(action, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Origin: server.url },
        body: JSON.stringify({ revision: 3 }),
      });
      expect(await result.json()).toEqual({ result: { accepted: true } });
      expect(actions).toEqual([{ action: "planning.confirm", payload: { revision: 3 } }]);
      const failure = await fetch(`${server.url}/api/action/error`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(failure.status).toBe(500);
      expect(await failure.text()).not.toContain("secret must not escape");
    } finally {
      server.stop();
      other.stop();
    }
  });

  test("streams only subscribed JSON events and disposes subscriptions on stop", async () => {
    const { session, listeners } = fixture();
    const server = createWorkspaceServer({ session });
    try {
      const { token } = await bootstrap(server.url);
      const response = await fetch(`${server.url}/api/events`, {
        headers: { ...client, "X-CSRF-Token": token },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(listeners.size).toBe(1);
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
      for (const listener of listeners) listener({ text: "<script>bad()</script>\nnext" });
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(
        'data: {"text":"<script>bad()</script>\\nnext"}\n\n',
      );
      server.stop();
      expect(listeners.size).toBe(0);
      await reader.cancel();
    } finally {
      server.stop();
    }
  });

  test("caps concurrent event subscriptions and releases a disconnected stream", async () => {
    const { session, listeners, disconnected } = fixture();
    const server = createWorkspaceServer({ session });
    const aborters: AbortController[] = [];
    try {
      const { token } = await bootstrap(server.url);
      const headers = { ...client, "X-CSRF-Token": token };
      for (let i = 0; i < 16; i++) {
        const aborter = new AbortController();
        aborters.push(aborter);
        expect(
          (await fetch(`${server.url}/api/events`, { headers, signal: aborter.signal })).status,
        ).toBe(200);
      }
      expect(listeners.size).toBe(16);
      expect((await fetch(`${server.url}/api/events`, { headers })).status).toBe(429);
      aborters[0]!.abort();
      await disconnected;
      expect(listeners.size).toBe(15);
      expect((await fetch(`${server.url}/api/events`, { headers })).status).toBe(200);
    } finally {
      for (const aborter of aborters) aborter.abort();
      server.stop();
    }
  });

  test("serves only assets in the explicitly configured directory with restrictive headers", async () => {
    const temp = await mkdtemp(join(tmpdir(), "lorelum-http-"));
    const root = join(temp, "build");
    await mkdir(root);
    await writeFile(join(root, "index.html"), "<!doctype html><div>app</div>");
    await writeFile(join(root, "app.js"), "console.log('app')");
    await writeFile(join(temp, "secret.txt"), "private outside asset root");
    const { session } = fixture();
    const server = createWorkspaceServer({ session, staticDirectory: root });
    const noAssets = createWorkspaceServer({ session });
    try {
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await page.text()).toContain("<div>app</div>");
      expect((await fetch(`${server.url}/app.js`)).status).toBe(200);
      expect((await fetch(`${server.url}/..%2fsecret.txt`)).status).toBe(404);
      expect((await fetch(`${server.url}/%2e%2e%2fsecret.txt`)).status).toBe(404);
      expect((await fetch(`${server.url}/missing`)).status).toBe(404);
      expect((await fetch(noAssets.url)).status).toBe(404);
    } finally {
      server.stop();
      noAssets.stop();
      await rm(temp, { recursive: true, force: true });
    }
  });
});
