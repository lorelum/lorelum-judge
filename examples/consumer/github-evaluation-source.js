import { createHash } from "node:crypto";

/** In-memory GitHub REST data for the actual source reader; no network or credential. */
export function exampleGitHubSource(oldText, newText) {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const subtree = "c".repeat(40);
  const blob = (text) => {
    const bytes = Buffer.from(text);
    return {
      sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      size: bytes.length,
      encoding: "base64",
      content: bytes.toString("base64"),
    };
  };
  const before = blob(oldText);
  const after = blob(newText);
  const tree = (content) => ({
    truncated: false,
    tree: [
      { path: "src", sha: subtree, type: "tree", mode: "040000" },
      { path: "src/list.js", sha: content.sha, type: "blob", mode: "100644", size: content.size },
    ],
  });
  const routes = {
    "/repos/example/project": { default_branch: "main" },
    "/repos/example/project/commits/main": { sha: head, parents: [{ sha: base }] },
    [`/repos/example/project/commits/${base}`]: { sha: base, parents: [] },
    [`/repos/example/project/commits/${head}`]: { sha: head, parents: [{ sha: base }] },
    [`/repos/example/project/git/trees/${base}?recursive=1`]: tree(before),
    [`/repos/example/project/git/trees/${head}?recursive=1`]: tree(after),
    [`/repos/example/project/git/blobs/${before.sha}`]: before,
    [`/repos/example/project/git/blobs/${after.sha}`]: after,
    [`/repos/example/project/compare/${base}...${head}`]: { merge_base_commit: { sha: base } },
    "/repos/example/project/pulls/7": {
      title: "Remove default limit",
      body: "Fixes #8",
      base: { sha: base },
      head: { sha: head, repo: { full_name: "example/project" } },
    },
    "/repos/example/project/issues/7/comments?per_page=100&page=1": [],
    "/repos/example/project/pulls/7/reviews?per_page=100&page=1": [],
    "/repos/example/project/pulls/7/comments?per_page=100&page=1": [],
    "/repos/example/project/issues/8": {
      title: "List contract",
      body: "At most 20 items must be returned.",
      updated_at: "2026-01-01T00:00:00Z",
    },
    "/repos/example/project/issues/8/comments?per_page=100&page=1": [],
  };
  const observed = [];
  return {
    base,
    head,
    observed,
    options: {
      repositories: ["example/project"],
      async fetch(input, init) {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (
          url.origin !== "https://api.github.com" ||
          init?.method !== "GET" ||
          init?.redirect !== "error"
        )
          throw new Error("unsafe source request");
        const key = url.pathname + url.search;
        observed.push(key);
        const row = routes[key];
        return new Response(JSON.stringify(row ?? { message: "not found" }), {
          status: row === undefined ? 404 : 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  };
}
