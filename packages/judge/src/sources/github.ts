import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { CodeSide, CodeSourceRole, CodeTarget } from "@lorelum/judge-protocol";
import { SourceCollector, validRequest } from "./shared.js";
import type { SourceOptions, SourceReadRequest, SourceSession } from "./types.js";

type Json = Record<string, unknown>;
type Entry = { path: string; sha: string; type: string; mode: string; size?: number };
type Tree = { entries: Map<string, Entry>; complete: boolean };
type View = { repo: string; sha: string; side: CodeSide; tree: Tree };
type Route = { repo: string; kind: string; tail: string; fragment: string };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const object = (value: unknown): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_response");
  return value as Json;
};
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("invalid_response");
  return value;
};
const sha = (value: unknown): string => {
  const result = string(value);
  if (!/^[a-f0-9]{40,64}$/i.test(result)) throw new Error("invalid_object_identity");
  return result;
};
const component = (value: string) => encodeURIComponent(value);
function routeOf(raw: string): Route {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search
  )
    throw new Error("unsupported_github_url");
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
  const owner = parts.shift();
  const name = parts.shift()?.replace(/\.git$/, "");
  if (
    !owner ||
    !name ||
    owner === "." ||
    owner === ".." ||
    name === "." ||
    name === ".." ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(name) ||
    parts.some((p) => !p || p === "." || p === ".." || p.includes("\\"))
  )
    throw new Error("invalid_github_path");
  const kind = parts.shift() ?? "repository";
  if (!["repository", "tree", "blob", "commit", "compare", "pull", "issues"].includes(kind))
    throw new Error("unsupported_github_route");
  if (kind === "repository" && parts.length) throw new Error("unsupported_github_route");
  return { repo: `${owner}/${name}`, kind, tail: parts.join("/"), fragment: url.hash.slice(1) };
}

/** Reads only GitHub REST GET resources; all code is subsequently read by immutable object ID. */
export async function collectGithubSource(
  target: Extract<CodeTarget, { kind: "github" }>,
  options: SourceOptions,
): Promise<SourceSession> {
  const collector = new SourceCollector(options);
  const { snapshot, limits } = collector;
  const views: View[] = [];
  const trees = new Map<string, Promise<Tree>>();
  const blobs = new Map<string, Uint8Array>();
  let root: Route | undefined;
  let verifyState: (() => Promise<boolean>) | undefined;
  const requirementVerifiers: { source: string; verify: () => Promise<boolean> }[] = [];
  const issue = (code: string, source?: string, fatal = false, detail?: string) => {
    collector.issue(code, `GitHub source: ${code}${detail ? ` (${detail})` : ""}`, source, fatal);
  };
  const omitted = (path: string, code: string) => {
    collector.omit(path, code, `GitHub source: ${code}`);
  };
  const active = () => {
    if (collector.cancelled()) throw new Error("cancelled");
  };
  const authorize = (repo: string) => {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
      repo.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("invalid_repository");
    const allowed = options.github?.repositories;
    if (allowed && !allowed.some((r) => r.toLowerCase() === repo.toLowerCase()))
      throw new Error("repository_not_authorized");
    // Without a caller allowlist, only the explicitly selected repository and its PR fork are used.
  };
  const api = async (repo: string, path: string): Promise<unknown> => {
    active();
    authorize(repo);
    if (!collector.request()) throw new Error("request_limit");
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (options.github?.token) headers.Authorization = `Bearer ${options.github.token}`;
    let response: Response;
    try {
      response = await (options.github?.fetch ?? globalThis.fetch)(
        `https://api.github.com/repos/${repo}${path ? `/${path}` : ""}`,
        {
          method: "GET",
          headers,
          redirect: "error",
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
    } catch {
      active();
      throw new Error("network_unavailable");
    }
    active();
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`http_${response.status}`);
    }
    const cap = Math.max(
      65536,
      Math.min(32 * 1024 * 1024, limits.maxEntries * 512 + limits.maxFileBytes * 2),
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty_response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        active();
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > cap) {
          await reader.cancel();
          throw new Error("response_limit");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    active();
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("invalid_response");
    }
  };
  const commit = async (repo: string, ref: string) =>
    sha(object(await api(repo, `commits/${component(ref)}`)).sha);
  const tree = (repo: string, version: string): Promise<Tree> => {
    const key = `${repo}:${version}`;
    const cached = trees.get(key);
    if (cached) return cached;
    const load = async (): Promise<Tree> => {
      const result: Tree = { entries: new Map(), complete: true };
      let enumerating = true;
      const add = (raw: unknown, prefix = "") => {
        const row = object(raw);
        const path = prefix + string(row.path);
        if (
          !path ||
          path.startsWith("/") ||
          path.split("/").some((p) => p === ".." || p === "." || !p) ||
          path.includes("\\")
        )
          throw new Error("invalid_tree_path");
        if (!collector.discover(path)) {
          result.complete = false;
          enumerating = false;
          return;
        }
        const entry: Entry = {
          path,
          sha: sha(row.sha),
          type: string(row.type),
          mode: string(row.mode),
          ...(typeof row.size === "number" ? { size: row.size } : {}),
        };
        result.entries.set(path, entry);
      };
      const recursive = object(await api(repo, `git/trees/${version}?recursive=1`));
      if (!Array.isArray(recursive.tree)) throw new Error("invalid_tree");
      if (recursive.truncated !== true) {
        for (const row of recursive.tree) {
          if (!enumerating) break;
          add(row);
        }
      } else {
        // Recursive trees are capped by GitHub. Walk each directory instead; never treat the prefix as complete.
        const queue = [{ id: version, prefix: "" }];
        for (let cursor = 0; cursor < queue.length; cursor++) {
          if (!enumerating) break;
          const next = queue[cursor];
          if (!next) break;
          const response = object(await api(repo, `git/trees/${next.id}`));
          if (!Array.isArray(response.tree)) throw new Error("invalid_tree");
          if (response.truncated === true) result.complete = false;
          for (const raw of response.tree) {
            if (!enumerating) break;
            add(raw, next.prefix);
            const row = object(raw);
            if (row.type === "tree")
              queue.push({ id: sha(row.sha), prefix: `${next.prefix}${string(row.path)}/` });
          }
        }
      }
      if (!result.complete) omitted(`${repo}@${version}:tree`, "tree_incomplete");
      return result;
    };
    const pending = load();
    trees.set(key, pending);
    return pending;
  };
  const view = async (repo: string, version: string, side: CodeSide) => {
    const value: View = { repo, sha: version, side, tree: await tree(repo, version) };
    views.push(value);
    return value;
  };
  const readFile = async (
    selected: View,
    path: string,
    role: CodeSourceRole,
    request?: SourceReadRequest,
  ) => {
    const entry = selected.tree.entries.get(path);
    if (!entry || entry.type === "tree") throw new Error("file_not_found");
    if (!collector.discover(path)) return;
    if (entry.type !== "blob" || entry.mode === "160000") {
      omitted(path, "submodule_unavailable");
      return;
    }
    if (entry.mode === "120000") {
      omitted(path, "symlink_not_followed");
      return;
    }
    const cacheKey = `${selected.repo}:${entry.sha}`;
    let data = blobs.get(cacheKey);
    if (data === undefined) {
      if (entry.size !== undefined && !collector.canAcquireBytes(entry.size, path)) return;
      const blob = object(await api(selected.repo, `git/blobs/${entry.sha}`));
      if (
        sha(blob.sha) !== entry.sha ||
        blob.encoding !== "base64" ||
        typeof blob.size !== "number"
      )
        throw new Error("invalid_blob");
      if (!collector.canAcquireBytes(blob.size, path)) return;
      const bytes = Buffer.from(string(blob.content).replace(/\s/g, ""), "base64");
      if (!collector.reserveBytes(bytes.byteLength, path)) return;
      if (bytes.byteLength !== blob.size) throw new Error("invalid_blob_size");
      const hashAlgorithm = entry.sha.length === 64 ? "sha256" : "sha1";
      if (
        createHash(hashAlgorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !==
        entry.sha
      )
        throw new Error("blob_identity_mismatch");
      data = bytes;
      blobs.set(cacheKey, data);
    }
    collector.add({
      path,
      bytes: data,
      role,
      side: selected.side,
      version: selected.sha,
      provenance: "github",
      ...(request ? { request } : {}),
    });
  };
  const collectTree = async (selected: View, prefix = "", role: CodeSourceRole = "target") => {
    const rows = [...selected.tree.entries.values()]
      .filter(
        (e) =>
          e.type !== "tree" && (!prefix || e.path === prefix || e.path.startsWith(`${prefix}/`)),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    if (prefix && !rows.length && !selected.tree.entries.has(prefix))
      throw new Error("path_not_found");
    for (const entry of rows) {
      if (!collector.discover(entry.path)) break;
      try {
        await readFile(selected, entry.path, role);
      } catch (error) {
        omitted(entry.path, errorCode(error));
      }
    }
  };
  const pages = async (repo: string, endpoint: string, accept: (row: Json) => boolean) => {
    for (let page = 1; ; page++) {
      const rows = await api(
        repo,
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows)) throw new Error("invalid_response");
      for (const raw of rows) {
        if (!accept(object(raw))) return;
      }
      if (rows.length < 100) return;
    }
  };
  const material = (row: Json, path: string, role: CodeSourceRole) => {
    const body = typeof row.body === "string" ? row.body : "";
    const title = typeof row.title === "string" ? `${row.title}\n\n` : "";
    // Include the inline comment's recorded location, not a fabricated location in the fixed code snapshot.
    const location =
      typeof row.path === "string"
        ? `Path: ${row.path}\nCommit: ${typeof row.commit_id === "string" ? row.commit_id : "unknown"}\nLine: ${typeof row.line === "number" ? row.line : "outdated"}\nSide: ${typeof row.side === "string" ? row.side : "unknown"}\n\n`
        : "";
    const text = title + location + body;
    if (!collector.discover(path)) return false;
    const bytes = Buffer.from(text);
    if (collector.reserveBytes(bytes.byteLength, path))
      collector.add({
        path,
        bytes,
        role,
        side: "current",
        version: `github-content:${digest(JSON.stringify(row))}`,
        provenance: "github",
      });
    return true;
  };
  const issueSource = async (repo: string, number: string, fragment = "") => {
    const row = object(await api(repo, `issues/${number}`));
    material(row, `https://github.com/${repo}/issues/${number}`, "requirement");
    if (fragment.startsWith("issuecomment-")) {
      const id = fragment.slice(13);
      if (!/^\d+$/.test(id)) throw new Error("invalid_comment_id");
      const comment = object(await api(repo, `issues/comments/${id}`));
      if (string(comment.issue_url) !== `https://api.github.com/repos/${repo}/issues/${number}`)
        throw new Error("comment_target_mismatch");
      material(comment, `https://github.com/${repo}/issues/${number}#${fragment}`, "opinion");
    } else
      await pages(repo, `issues/${number}/comments`, (comment) =>
        material(
          comment,
          `https://github.com/${repo}/issues/${number}#issuecomment-${stringId(comment.id)}`,
          "opinion",
        ),
      );
    const identity = digest(JSON.stringify(row));
    return async () => digest(JSON.stringify(await api(repo, `issues/${number}`))) === identity;
  };
  const comparison = async (
    baseRepo: string,
    baseSha: string,
    headRepo: string,
    headSha: string,
    kind: string,
    useMergeBase: boolean,
  ) => {
    let oldSha = baseSha;
    if (useMergeBase) {
      const headRef =
        baseRepo.toLowerCase() === headRepo.toLowerCase()
          ? headSha
          : `${headRepo.split("/")[0]}:${headSha}`;
      const compared = object(
        await api(baseRepo, `compare/${component(baseSha)}...${component(headRef)}`),
      );
      oldSha = sha(object(compared.merge_base_commit).sha);
    }
    snapshot.comparisons.push({
      source: target.url,
      kind,
      base: baseSha,
      head: headSha,
      ...(useMergeBase ? { mergeBase: oldSha } : {}),
    });
    const old = await view(baseRepo, oldSha, "old");
    const current = await view(headRepo, headSha, "new");
    const recorded = snapshot.comparisons.at(-1);
    if (recorded && old.tree.complete && current.tree.complete) {
      recorded.addedPaths = [...current.tree.entries.values()]
        .filter((entry) => entry.type !== "tree" && !old.tree.entries.has(entry.path))
        .map((entry) => entry.path);
      recorded.deletedPaths = [...old.tree.entries.values()]
        .filter((entry) => entry.type !== "tree" && !current.tree.entries.has(entry.path))
        .map((entry) => entry.path);
    }
    const paths = [...new Set([...old.tree.entries.keys(), ...current.tree.entries.keys()])].sort();
    for (const path of paths) {
      const before = old.tree.entries.get(path);
      const after = current.tree.entries.get(path);
      if (before?.type === "tree" && after?.type === "tree") continue;
      if (before?.sha === after?.sha && before?.mode === after?.mode) continue;
      if (!collector.discover(path)) break;
      for (const selected of [old, current]) {
        const entry = selected.tree.entries.get(path);
        if (!entry || entry.type === "tree") continue;
        try {
          await readFile(selected, path, "target");
        } catch (error) {
          omitted(path, errorCode(error));
        }
      }
    }
    if (!old.tree.complete || !current.tree.complete) issue("comparison_incomplete", target.url);
  };
  const resolvePath = async (repo: string, tail: string, kind: string) => {
    const parts = tail.split("/");
    const matches: { ref: string; version: string; path: string; selected: View }[] = [];
    for (let index = 1; index <= parts.length; index++) {
      active();
      const ref = parts.slice(0, index).join("/");
      const path = parts.slice(index).join("/");
      if (kind === "blob" && !path) continue;
      let version: string;
      try {
        version = await commit(repo, ref);
      } catch (error) {
        if (["http_404", "http_422"].includes(errorCode(error))) continue;
        throw error;
      }
      const candidate: View = {
        repo,
        sha: version,
        side: "current",
        tree: await tree(repo, version),
      };
      const entry = candidate.tree.entries.get(path);
      if (
        (!path && kind === "tree") ||
        (entry && (kind === "blob" ? entry.type === "blob" : entry.type === "tree"))
      )
        matches.push({ ref, version, path, selected: candidate });
      else if (!candidate.tree.complete) throw new Error("ambiguous_ref_incomplete_tree");
    }
    if (matches.length !== 1)
      throw new Error(matches.length ? "ambiguous_ref" : "ref_or_path_not_found");
    const match = matches[0];
    if (!match) throw new Error("ref_or_path_not_found");
    views.push(match.selected);
    verifyState = async () => (await commit(repo, match.ref)) === match.version;
    await collectTree(match.selected, match.path);
  };
  const read = async (request: SourceReadRequest): Promise<void> => {
    if (!validRequest(collector, request)) return;
    try {
      active();
      if (!root) throw new Error("source_unavailable");
      const path = request.path.replace(/\/$/, "");
      if (
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((p) => p === ".." || p === ".") ||
        path.includes("://")
      )
        throw new Error("path_not_authorized");
      const side = request.side ?? (views.some((v) => v.side === "new") ? "new" : "current");
      const selected = views.find((v) => v.side === side);
      if (!selected) throw new Error("side_unavailable");
      if (request.kind === "read") await readFile(selected, path, "context", request);
      else if (request.kind === "list") {
        for (const entry of selected.tree.entries.values()) {
          if (!path || entry.path === path || entry.path.startsWith(`${path}/`)) {
            if (!collector.discover(entry.path)) break;
          }
        }
        if (!selected.tree.complete) issue("list_incomplete", path);
      } else if (request.kind === "search") {
        // Search is literal and local to the pinned tree; no code-search index can silently use another revision.
        for (const entry of selected.tree.entries.values()) {
          if (
            entry.type !== "blob" ||
            (path && entry.path !== path && !entry.path.startsWith(`${path}/`))
          )
            continue;
          await readFile(selected, entry.path, "context", request);
        }
        if (!selected.tree.complete) issue("search_incomplete", path);
      } else throw new Error("unsupported_read_kind");
    } catch (error) {
      issue(errorCode(error), request.path);
    }
  };
  const verify = async () => {
    if (!collector.beginVerification()) return;
    try {
      active();
      if (verifyState && !(await verifyState())) {
        snapshot.consistent = false;
        issue("source_changed", target.url);
      }
      for (const reference of requirementVerifiers) {
        if (!(await reference.verify())) {
          snapshot.consistent = false;
          issue("source_changed", reference.source);
        }
      }
    } catch (error) {
      const code = errorCode(error);
      issue(
        code === "cancelled" ? "cancelled" : "verification_unavailable",
        target.url,
        false,
        code,
      );
    }
  };
  try {
    active();
    root = routeOf(target.url);
    authorize(root.repo);
    const { repo, kind, tail, fragment } = root;
    if (kind === "repository") {
      const metadata = object(await api(repo, ""));
      const branch = string(metadata.default_branch);
      const version = await commit(repo, branch);
      verifyState = async () => (await commit(repo, branch)) === version;
      await collectTree(await view(repo, version, "current"));
    } else if (kind === "tree" || kind === "blob") await resolvePath(repo, tail, kind);
    else if (kind === "commit") {
      if (!tail || tail.includes("/")) throw new Error("invalid_commit_route");
      const row = object(await api(repo, `commits/${component(tail)}`));
      const version = sha(row.sha);
      if (!Array.isArray(row.parents)) throw new Error("invalid_commit_parents");
      verifyState = async () => (await commit(repo, tail)) === version;
      if (row.parents.length)
        await comparison(
          repo,
          sha(object(row.parents[0]).sha),
          repo,
          version,
          "commit:first-parent",
          false,
        );
      else {
        snapshot.comparisons.push({
          source: target.url,
          kind: "commit:root",
          base: "empty-tree",
          head: version,
        });
        const current = await view(repo, version, "new");
        const recorded = snapshot.comparisons.at(-1);
        if (recorded && current.tree.complete)
          recorded.addedPaths = [...current.tree.entries.values()]
            .filter((entry) => entry.type !== "tree")
            .map((entry) => entry.path);
        await collectTree(current);
      }
    } else if (kind === "compare") {
      const separator = tail.includes("...") ? "..." : "..";
      const refs = tail.split(separator);
      if (refs.length !== 2 || !refs[0] || !refs[1]) throw new Error("invalid_compare_route");
      const resolveRef = async (value: string) => {
        const parts = value.split(":");
        const selectedRepo =
          parts.length === 1
            ? repo
            : `${parts[0]}/${parts.length === 3 ? parts[1] : repo.split("/")[1]}`;
        const ref = parts[parts.length - 1];
        if (parts.length > 3 || !ref) throw new Error("invalid_compare_ref");
        authorize(selectedRepo);
        return { repo: selectedRepo, ref, sha: await commit(selectedRepo, ref) };
      };
      const base = await resolveRef(refs[0]);
      const head = await resolveRef(refs[1]);
      verifyState = async () =>
        (await commit(base.repo, base.ref)) === base.sha &&
        (await commit(head.repo, head.ref)) === head.sha;
      await comparison(
        base.repo,
        base.sha,
        head.repo,
        head.sha,
        separator === "..." ? "compare:merge-base" : "compare:direct",
        separator === "...",
      );
    } else if (kind === "issues") {
      if (!/^\d+$/.test(tail)) throw new Error("invalid_issue_route");
      verifyState = await issueSource(repo, tail, fragment);
    } else if (kind === "pull") {
      const match = /^(\d+)(?:\/(files|commits))?$/.exec(tail);
      if (!match) throw new Error("invalid_pull_route");
      const number = match[1];
      const row = object(await api(repo, `pulls/${number}`));
      const base = object(row.base);
      const head = object(row.head);
      const baseSha = sha(base.sha);
      const headSha = sha(head.sha);
      const headRepo = string(object(head.repo).full_name);
      authorize(headRepo);
      verifyState = async () => {
        const next = object(await api(repo, `pulls/${number}`));
        return sha(object(next.base).sha) === baseSha && sha(object(next.head).sha) === headSha;
      };
      material(row, `https://github.com/${repo}/pull/${number}`, "context");
      await comparison(repo, baseSha, headRepo, headSha, "pull:merge-base", true);
      await pages(repo, `issues/${number}/comments`, (comment) =>
        material(
          comment,
          `https://github.com/${repo}/pull/${number}#issuecomment-${stringId(comment.id)}`,
          "opinion",
        ),
      );
      await pages(repo, `pulls/${number}/reviews`, (review) =>
        material(
          review,
          `https://github.com/${repo}/pull/${number}#pullrequestreview-${stringId(review.id)}`,
          "opinion",
        ),
      );
      await pages(repo, `pulls/${number}/comments`, (comment) =>
        material(
          comment,
          `https://github.com/${repo}/pull/${number}#discussion_r${stringId(comment.id)}`,
          "opinion",
        ),
      );
      if (fragment && !snapshot.discovered.some((p) => p.endsWith(`#${fragment}`)))
        issue("linked_comment_unavailable", target.url);
      // Explicit closing references are requirements; arbitrary discussion links do not grant repository access.
      const body = typeof row.body === "string" ? row.body : "";
      const refs = new Set<string>();
      for (const linked of body.matchAll(
        /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/)?#?(\d+)\b/gi,
      )) {
        const linkedRepo = linked[1] ?? repo;
        const linkedNumber = linked[2];
        if (!linkedNumber) continue;
        if (
          linkedRepo.toLowerCase() !== repo.toLowerCase() &&
          !options.github?.repositories?.some((r) => r.toLowerCase() === linkedRepo.toLowerCase())
        ) {
          issue("linked_repository_not_authorized", `${linkedRepo}/issues/${linkedNumber}`);
          continue;
        }
        const key = `${linkedRepo}/${linkedNumber}`;
        if (!refs.has(key)) {
          refs.add(key);
          const verify = await issueSource(linkedRepo, linkedNumber);
          requirementVerifiers.push({
            source: `https://github.com/${linkedRepo}/issues/${linkedNumber}`,
            verify,
          });
        }
      }
    }
  } catch (error) {
    issue(
      errorCode(error),
      "github",
      !snapshot.items.some((item) => item.role === "target" || item.role === "requirement"),
    );
  }
  return { snapshot, read, verify };
}
function errorCode(error: unknown): string {
  // Never surface fetch error messages/URLs/headers, which can contain caller secrets.
  return error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)
    ? error.message
    : "source_unavailable";
}
function stringId(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid_comment_id");
  const id = String(value);
  if (!/^\d+$/.test(id)) throw new Error("invalid_comment_id");
  return id;
}
