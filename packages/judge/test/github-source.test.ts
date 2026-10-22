import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ModelPort } from "@lorelum/judge-runtime";
import { evaluateCode } from "../src/index.js";
import { collectGithubSource } from "../src/sources/github.js";

function blob(text: string) {
  const bytes = Buffer.from(text);
  return {
    sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    size: bytes.length,
    encoding: "base64",
    content: bytes.toString("base64"),
  };
}
function http(routes: Record<string, unknown>, observed: string[] = []): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    expect(url.origin).toBe("https://api.github.com");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    const key = url.pathname + url.search;
    observed.push(key);
    const row = routes[key];
    return new Response(JSON.stringify(row ?? { message: "Not found" }), {
      status: row === undefined ? 404 : 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

test("fork PR uses merge-base trees, recovers a truncated tree and binds inline opinions and requirements", async () => {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const mergeBase = "c".repeat(40);
  const subtree = "d".repeat(40);
  const old = blob("old behavior\n");
  const current = blob("new behavior\n");
  const pull = {
    title: "Change",
    body: "Fixes #7",
    base: { sha: base },
    head: { sha: head, repo: { full_name: "fork/project" } },
  };
  const routes: Record<string, unknown> = {
    "/repos/up/project/pulls/3": pull,
    [`/repos/up/project/compare/${base}...fork%3A${head}`]: {
      merge_base_commit: { sha: mergeBase },
    },
    [`/repos/up/project/git/trees/${mergeBase}?recursive=1`]: {
      tree: [{ path: "src/a.ts", sha: old.sha, type: "blob", mode: "100644", size: old.size }],
      truncated: false,
    },
    [`/repos/fork/project/git/trees/${head}?recursive=1`]: { tree: [], truncated: true },
    [`/repos/fork/project/git/trees/${head}`]: {
      tree: [{ path: "src", sha: subtree, type: "tree", mode: "040000" }],
    },
    [`/repos/fork/project/git/trees/${subtree}`]: {
      tree: [{ path: "a.ts", sha: current.sha, type: "blob", mode: "100644", size: current.size }],
    },
    [`/repos/up/project/git/blobs/${old.sha}`]: old,
    [`/repos/fork/project/git/blobs/${current.sha}`]: current,
    "/repos/up/project/issues/3/comments?per_page=100&page=1": [],
    "/repos/up/project/pulls/3/reviews?per_page=100&page=1": [],
    "/repos/up/project/pulls/3/comments?per_page=100&page=1": [
      {
        id: 44,
        body: "Check the boundary",
        path: "src/a.ts",
        commit_id: head,
        line: 1,
        side: "RIGHT",
      },
    ],
    "/repos/up/project/issues/7": { title: "Requirement", body: "Must preserve the boundary" },
    "/repos/up/project/issues/7/comments?per_page=100&page=1": [],
  };
  const observed: string[] = [];
  const session = await collectGithubSource(
    { kind: "github", url: "https://github.com/up/project/pull/3#discussion_r44" },
    { github: { fetch: http(routes, observed) } },
  );
  expect(session.snapshot.issues).toEqual([]);
  expect(session.snapshot.comparisons[0]).toMatchObject({ base, head, mergeBase });
  expect(
    session.snapshot.items
      .filter((item) => item.path === "src/a.ts")
      .map((item) => [item.side, item.version, item.text]),
  ).toEqual([
    ["old", mergeBase, "old behavior\n"],
    ["new", head, "new behavior\n"],
  ]);
  expect(
    session.snapshot.items.some(
      (item) => item.role === "opinion" && item.text.includes("Check the boundary"),
    ),
  ).toBe(true);
  expect(
    session.snapshot.items.some(
      (item) => item.role === "requirement" && item.text.includes("Must preserve the boundary"),
    ),
  ).toBe(true);
  routes["/repos/up/project/pulls/3"] = { ...pull, head: { sha: "e".repeat(40) } };
  await session.verify();
  expect(session.snapshot.consistent).toBe(false);
  expect(session.snapshot.issues.some((item) => item.code === "source_changed")).toBe(true);
  expect(observed.some((path) => path.includes("/pulls/3/files"))).toBe(false);
});

test("slash ref with multiple valid path interpretations is rejected rather than guessed", async () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const content = blob("code");
  const session = await collectGithubSource(
    { kind: "github", url: "https://github.com/up/project/blob/feature/topic/a.ts" },
    {
      github: {
        fetch: http({
          "/repos/up/project/commits/feature": { sha: a },
          "/repos/up/project/commits/feature%2Ftopic": { sha: b },
          [`/repos/up/project/git/trees/${a}?recursive=1`]: {
            tree: [{ path: "topic/a.ts", type: "blob", mode: "100644", sha: content.sha }],
          },
          [`/repos/up/project/git/trees/${b}?recursive=1`]: {
            tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: content.sha }],
          },
        }),
      },
    },
  );
  expect(session.snapshot.items).toEqual([]);
  expect(
    session.snapshot.issues.some((issue) => issue.code === "ambiguous_ref" && issue.fatal),
  ).toBe(true);
});

test("issue comments paginate without upgrading opinions to requirements", async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({ id: id + 1, body: `opinion ${id}` }));
  const session = await collectGithubSource(
    { kind: "github", url: "https://github.com/up/project/issues/7" },
    {
      limits: { maxFiles: 110 },
      github: {
        fetch: http({
          "/repos/up/project/issues/7": { title: "Requirement", body: "Required behavior" },
          "/repos/up/project/issues/7/comments?per_page=100&page=1": first,
          "/repos/up/project/issues/7/comments?per_page=100&page=2": [
            { id: 101, body: "last opinion" },
          ],
        }),
      },
    },
  );
  expect(
    session.snapshot.items.filter((item) => item.role === "requirement").map((item) => item.text),
  ).toEqual(["Requirement\n\nRequired behavior"]);
  expect(
    session.snapshot.items.find((item) => item.path.endsWith("#issuecomment-101")),
  ).toMatchObject({ role: "opinion", text: "last opinion" });
});

test("pre-cancel and unauthorized repositories perform no network reads", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw new Error("must not request");
  }) as unknown as typeof globalThis.fetch;
  const cancelled = await collectGithubSource(
    { kind: "github", url: "https://github.com/up/project" },
    { signal: controller.signal, github: { fetch: fetcher, token: "private-secret" } },
  );
  const denied = await collectGithubSource(
    { kind: "github", url: "https://github.com/up/project" },
    { github: { fetch: fetcher, repositories: ["other/project"], token: "private-secret" } },
  );
  expect(calls).toBe(0);
  expect(cancelled.snapshot.issues.some((issue) => issue.code === "cancelled" && issue.fatal)).toBe(
    true,
  );
  expect(
    denied.snapshot.issues.some(
      (issue) => issue.code === "repository_not_authorized" && issue.fatal,
    ),
  ).toBe(true);
  expect(JSON.stringify([cancelled.snapshot, denied.snapshot])).not.toContain("private-secret");
});

test("cancellation during final source verification preserves completed evaluation but cancels the request", async () => {
  const controller = new AbortController();
  const commit = "a".repeat(40);
  const content = blob("export const value = 1;\n");
  const underlying = http({
    "/repos/up/project/commits/main": { sha: commit },
    [`/repos/up/project/git/trees/${commit}?recursive=1`]: {
      tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: content.sha, size: content.size }],
      truncated: false,
    },
    [`/repos/up/project/git/blobs/${content.sha}`]: content,
  });
  let evaluated = false;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (evaluated) {
      controller.abort();
      throw new Error("cancelled during final verification");
    }
    return underlying(input, init);
  }) as typeof globalThis.fetch;
  const model: ModelPort = {
    async generate(request) {
      if (request.messages[0]?.content.includes("You prepare"))
        return {
          kind: "message",
          content: JSON.stringify({
            task: "inspect",
            focus: [],
            standards: ["behavior"],
            requirements: [],
            excluded: ["boundaries", "security", "concurrency", "performance", "maintenance"].map(
              (id) => ({ id, reason: "Source cancellation regression." }),
            ),
            reads: [],
          }),
        };
      const user = request.messages.find((message) => message.role === "user")?.content ?? "";
      const marker = "Untrusted review context:\n";
      const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)) as {
        sources: { id: string }[];
      };
      evaluated = true;
      return {
        kind: "message",
        content: JSON.stringify({
          schema: "lorelum.judge.review-result/v2",
          verdicts: [
            {
              schema: "lorelum.judge.verdict/v1",
              criterionId: "behavior",
              verdict: "strong",
              evidenceIds: [context.sources[0]?.id],
              rationale: "The shown declaration is consistent.",
            },
          ],
          summary: [],
          problems: [],
          pending: [],
          followUps: [],
        }),
      };
    },
  };
  const result = await evaluateCode(
    { target: "https://github.com/up/project/blob/main/a.ts" },
    {
      model,
      method: {
        kind: "llm",
        provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
        endpointIdentity: `sha256:${"a".repeat(64)}`,
        model: { provider: "offline", name: "cancel-source" },
      },
      allowModelDisclosure: true,
      signal: controller.signal,
      limits: { maxContextRounds: 0 },
      sources: { github: { fetch } },
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(result.value.execution?.attempts[0]?.status).toBe("completed");
  expect(result.value.result?.verdicts[0]?.verdict).toBe("strong");
  expect(result.value.status).toBe("cancelled");
});
