import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SessionRouter } from "../src/session.js";

test("cancelling during final PR verification preserves completed evaluation facts", async () => {
  const originalFetch = globalThis.fetch;
  const base = "a".repeat(40),
    head = "b".repeat(40),
    merge = "c".repeat(40);
  const blob = (content: string) => {
    const bytes = Buffer.from(content);
    return {
      sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      size: bytes.length,
      encoding: "base64",
      content: bytes.toString("base64"),
    };
  };
  const old = blob("export const value = 0;\n");
  const current = blob("export const value = 1;\n");
  const pull = {
    title: "Change",
    body: "",
    base: { sha: base, repo: { full_name: "up/project" } },
    head: { sha: head, repo: { full_name: "up/project" } },
  };
  const tree = (item: typeof old) => ({
    tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: item.sha, size: item.size }],
    truncated: false,
  });
  const routes: Record<string, unknown> = {
    "/repos/up/project/pulls/3": pull,
    [`/repos/up/project/compare/${base}...${head}`]: { merge_base_commit: { sha: merge } },
    [`/repos/up/project/git/trees/${merge}?recursive=1`]: tree(old),
    [`/repos/up/project/git/trees/${head}?recursive=1`]: tree(current),
    [`/repos/up/project/git/blobs/${old.sha}`]: old,
    [`/repos/up/project/git/blobs/${current.sha}`]: current,
    "/repos/up/project/issues/3/comments?per_page=100&page=1": [],
    "/repos/up/project/pulls/3/reviews?per_page=100&page=1": [],
    "/repos/up/project/pulls/3/comments?per_page=100&page=1": [],
  };
  const verificationStarted = Promise.withResolvers<void>();
  const releaseVerification = Promise.withResolvers<void>();
  let evaluated = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== "https://api.github.com") return originalFetch(input, init);
    const key = url.pathname + url.search;
    if (evaluated && key === "/repos/up/project/pulls/3") {
      verificationStarted.resolve();
      await releaseVerification.promise;
    }
    if (!(key in routes)) throw new Error(`Unexpected GitHub route: ${key}`);
    return Response.json(routes[key]);
  }) as typeof globalThis.fetch;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      const user = body.messages.find((message) => message.role === "user")?.content ?? "";
      let response: unknown;
      if (body.messages[0]?.content.includes("You prepare")) {
        response = {
          task: "inspect",
          focus: [],
          standards: ["behavior"],
          requirements: [],
          excluded: ["boundaries", "security", "concurrency", "performance", "maintenance"].map(
            (id) => ({ id, reason: "Only visible behavior is examined." }),
          ),
          reads: [],
        };
      } else {
        const marker = "Untrusted review context:\n";
        const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)) as {
          sources: { id: string; role: string }[];
        };
        const item = context.sources.find((source) => source.role === "target");
        if (!item) throw new Error("Missing target");
        const criteria = [...user.matchAll(/^Criterion ([^ ]+) \((quality|contract),/gm)];
        response = {
          schema: "lorelum.judge.review-result/v2",
          verdicts: criteria.map((entry) => ({
            schema: "lorelum.judge.verdict/v1",
            criterionId: entry[1],
            verdict: "strong",
            evidenceIds: [item.id],
            rationale: "The declaration is visible.",
          })),
          summary: [],
          problems: [],
          pending: [],
          followUps: [],
        };
        evaluated = true;
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
    },
  });
  const session = new SessionRouter({
    configuredModel: {
      endpoint: `http://127.0.0.1:${server.port}/v1`,
      config: { model: "review-model" },
    },
  });
  type State = {
    executionDisclosure: { identity: string } | null;
    evaluation: {
      status: string;
      report: {
        execution?: { attempts: { status: string }[] };
        result?: { verdicts: { verdict: string }[] };
      } | null;
      text: string | null;
    };
  };
  const call = async (action: string, payload: unknown) =>
    (await session.dispatch(action, payload)) as { ok: boolean; state: State };
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
    await call("model.configured", {});
    expect(
      (await call("evaluation.start", { target: "https://github.com/up/project/pull/3" })).ok,
    ).toBe(true);
    let state = await next((value) => value.executionDisclosure !== null);
    const first = state.executionDisclosure?.identity;
    await call("execution.disclosure.allow", { identity: first });
    state = await next(
      (value) => value.executionDisclosure !== null && value.executionDisclosure.identity !== first,
    );
    await call("execution.disclosure.allow", { identity: state.executionDisclosure?.identity });
    await verificationStarted.promise;
    const cancelled = await call("evaluation.cancel", {});
    expect(cancelled.state.evaluation.status).toBe("cancelled");
    releaseVerification.resolve();
    state = await next(
      (value) => value.evaluation.status === "cancelled" && value.evaluation.report !== null,
    );
    expect(state.evaluation.report?.execution?.attempts[0]?.status).toBe("completed");
    expect(state.evaluation.report?.result?.verdicts[0]?.verdict).toBe("strong");
    expect(state.evaluation.text).toBeTruthy();
  } finally {
    releaseVerification.resolve();
    globalThis.fetch = originalFetch;
    server.stop(true);
  }
}, 30000);
