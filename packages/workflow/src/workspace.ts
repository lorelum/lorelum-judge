import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { identityOf } from "@lorelum/judge-protocol";
import { readSafeSource, type SafeSourceRoot, safeSourceRoot } from "./safe-source.js";

/** A review item, not an authorization to disclose or execute anything. */
export interface WorkspaceCandidate {
  readonly path: string;
  readonly origin: "committed" | "modified" | "untracked";
  readonly status: "present" | "deleted" | "excluded";
  readonly exclusionReason: string | null;
  readonly contentIdentity: string | null;
  readonly mode: number | null;
  readonly size: number | null;
}

export interface WorkspaceCandidateReview {
  readonly root: string;
  readonly rootIdentity: { readonly dev: string; readonly ino: string };
  readonly gitIdentity: string;
  readonly identity: string;
  readonly candidates: readonly WorkspaceCandidate[];
}
const sourceRoots = new WeakMap<WorkspaceCandidateReview, SafeSourceRoot>();

/** Retain the live, non-serializable source capability in a detached review copy. */
export function cloneWorkspaceReview(review: WorkspaceCandidateReview): WorkspaceCandidateReview {
  const root = sourceRoots.get(review);
  if (!root) throw new Error("Workspace review has no live source capability");
  const copied = structuredClone(review);
  sourceRoots.set(copied, root);
  return copied;
}

/** Close the pinned source root when the host abandons or completes the review. */
export async function closeWorkspaceReview(review: WorkspaceCandidateReview): Promise<void> {
  const root = sourceRoots.get(review);
  sourceRoots.delete(review);
  if (root) await root.close();
}

/** Exclusions are explicit user/host decisions, not a claim that other files are nonsensitive. */
export interface WorkspaceExclusion {
  readonly path: string;
  readonly reason: string;
}

function pathIsSafe(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  );
}

async function gitOutput(
  root: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  if (signal && process.platform !== "linux")
    throw new Error("Cancellable Git process-tree cleanup requires Linux");
  signal?.throwIfAborted();
  const { promise, resolve: resolveOutput, reject } = Promise.withResolvers<Buffer>();
  const child = spawn(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "core.pager=cat",
      ...args,
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform === "linux",
    },
  );
  const terminate = () => {
    if (process.platform === "linux" && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    } else child.kill("SIGKILL");
  };
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  let outputError: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 64 * 1024 * 1024) {
      outputError = new Error("Git output exceeded the maximum buffer");
      terminate();
    } else chunks.push(chunk);
  });
  child.stderr.resume();
  child.once("error", reject);
  child.once("close", (code, childSignal) => {
    if (outputError) reject(outputError);
    else if (code !== 0) reject(new Error(`Git command failed (${childSignal ?? code})`));
    else resolveOutput(Buffer.concat(chunks, outputBytes));
  });
  signal?.addEventListener("abort", terminate, { once: true });
  if (signal?.aborted) terminate();
  try {
    const result = await promise;
    signal?.throwIfAborted();
    return new TextDecoder("utf-8", { fatal: true }).decode(result);
  } finally {
    signal?.removeEventListener("abort", terminate);
    terminate();
  }
}

async function git(root: string, args: readonly string[], signal?: AbortSignal): Promise<string[]> {
  return (await gitOutput(root, args, signal)).split("\0").filter(Boolean);
}

async function gitMetadataIdentity(root: string, signal?: AbortSignal): Promise<string> {
  const head = await gitOutput(root, ["rev-parse", "--verify", "HEAD"], signal);
  const index = await gitOutput(root, ["ls-files", "--stage", "--debug", "-z"], signal);
  const config = await gitOutput(
    root,
    ["config", "--local", "--no-includes", "--null", "--list"],
    signal,
  );
  const result = identityOf("workflow-git-metadata/v1", { head, index, config });
  if (!result.ok) throw new Error("Cannot identify Git metadata");
  return result.identity;
}

/**
 * Discover and hash the real Git working tree. This function does not authorize
 * inclusion, disclosure or execution. Ignored files are included in the review so
 * that the host must explicitly exclude sensitive and unwanted material.
 */
export async function discoverWorkspace(
  root: string,
  exclusions: readonly WorkspaceExclusion[],
  signal?: AbortSignal,
): Promise<WorkspaceCandidateReview> {
  signal?.throwIfAborted();
  if (!isAbsolute(root)) throw new Error("Project root must be absolute");
  const absolute = resolve(root);
  if ((await realpath(absolute)) !== absolute)
    throw new Error("Project root must not traverse symbolic links");
  const rootHandle = await safeSourceRoot(absolute, signal);
  const rootIdentity = { dev: rootHandle.dev, ino: rootHandle.ino };
  try {
    const gitIdentity = await gitMetadataIdentity(absolute, signal);
    const topOutput = await gitOutput(absolute, ["rev-parse", "--show-toplevel"], signal);
    const top = topOutput.endsWith("\n") ? topOutput.slice(0, -1) : topOutput;
    if (resolve(top) !== absolute || relative(absolute, top).split(sep).includes(".."))
      throw new Error("Expected Git project root");
    const excluded = new Map<string, string>();
    for (const item of exclusions) {
      if (!pathIsSafe(item.path) || !item.reason.trim() || excluded.has(item.path))
        throw new Error("Invalid exclusion");
      excluded.set(item.path, item.reason);
    }
    if ((await git(absolute, ["ls-files", "--unmerged", "-z"], signal)).length)
      throw new Error("Unmerged Git index entries are unsupported");
    // `git diff` trusts these index flags and can miss actual working-tree bytes.
    // -v lowercases assume-unchanged entries; S denotes skip-worktree.
    const indexTags = await git(absolute, ["ls-files", "-v", "-z", "--cached"], signal);
    if (indexTags.some((entry) => entry[0] === "S" || /^[a-z] /.test(entry)))
      throw new Error("Git index contains assume-unchanged or skip-worktree entries");
    const tracked = new Set(await git(absolute, ["ls-files", "-z", "--cached"], signal));
    const untracked = new Set(await git(absolute, ["ls-files", "-z", "--others"], signal));
    const modified = new Set([
      ...(await git(
        absolute,
        [
          "diff",
          "--name-only",
          "-z",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--ignore-submodules=all",
        ],
        signal,
      )),
      ...(await git(
        absolute,
        [
          "diff",
          "--cached",
          "--name-only",
          "-z",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--ignore-submodules=all",
        ],
        signal,
      )),
    ]);
    const paths = [...new Set([...tracked, ...untracked])].sort();
    const candidates: WorkspaceCandidate[] = [];
    for (const path of paths) {
      signal?.throwIfAborted();
      if (!pathIsSafe(path)) throw new Error(`Unsupported Git path: ${path}`);
      const origin = untracked.has(path)
        ? "untracked"
        : modified.has(path)
          ? "modified"
          : "committed";
      const reason = excluded.get(path);
      if (reason !== undefined) {
        candidates.push({
          path,
          origin,
          status: "excluded",
          exclusionReason: reason,
          contentIdentity: null,
          mode: null,
          size: null,
        });
        continue;
      }
      const file = await readSafeSource(absolute, path, rootHandle, signal);
      candidates.push(
        file
          ? {
              path,
              origin,
              status: "present",
              exclusionReason: null,
              contentIdentity: `sha256:${createHash("sha256").update(file.data).digest("hex")}`,
              mode: file.mode,
              size: file.data.byteLength,
            }
          : {
              path,
              origin,
              status: "deleted",
              exclusionReason: null,
              contentIdentity: null,
              mode: null,
              size: null,
            },
      );
    }
    for (const path of excluded.keys())
      if (!paths.includes(path)) throw new Error(`Excluded path is not a candidate: ${path}`);
    const finalRoot = await safeSourceRoot(absolute, signal);
    try {
      if (finalRoot.dev !== rootIdentity.dev || finalRoot.ino !== rootIdentity.ino)
        throw new Error("Project root changed during discovery");
    } finally {
      await finalRoot.close();
    }
    if ((await gitMetadataIdentity(absolute, signal)) !== gitIdentity)
      throw new Error("Git metadata changed during discovery");
    signal?.throwIfAborted();
    const identity = identityOf("workflow-workspace-candidates/v1", {
      root: absolute,
      rootIdentity,
      gitIdentity,
      candidates,
    });
    if (!identity.ok) throw new Error("Unable to identify workspace candidates");
    const review = {
      root: absolute,
      rootIdentity,
      gitIdentity,
      identity: identity.identity,
      candidates,
    };
    sourceRoots.set(review, rootHandle);
    return review;
  } catch (error) {
    await rootHandle.close();
    throw error;
  }
}

/** Create a private snapshot using only securely opened, rechecked source bytes. */
export async function createWorkspaceSnapshot(
  reviewed: WorkspaceCandidateReview,
  guard: () => void,
  signal?: AbortSignal,
): Promise<string> {
  const pinnedRoot = sourceRoots.get(reviewed);
  if (!pinnedRoot) throw new Error("Workspace review has no live source capability");
  const captured = structuredClone(reviewed);
  const exclusions = captured.candidates
    .filter((item) => item.status === "excluded")
    .map((item) => ({ path: item.path, reason: item.exclusionReason ?? "" }));
  guard();
  const current = await discoverWorkspace(captured.root, exclusions, signal);
  try {
    guard();
    if (current.identity !== captured.identity) throw new Error("Workspace changed after review");
  } finally {
    await closeWorkspaceReview(current);
  }
  const parent = await realpath(tmpdir());
  guard();
  const destination = await mkdtemp(join(parent, "lorelum-workflow-"));
  try {
    if (destination === captured.root || destination.startsWith(`${captured.root}${sep}`))
      throw new Error("Private snapshot must be outside the original project");
    for (const item of current.candidates) {
      guard();
      if (item.status !== "present") continue;
      const file = await readSafeSource(current.root, item.path, pinnedRoot, signal);
      guard();
      if (
        !file ||
        file.mode !== item.mode ||
        file.data.byteLength !== item.size ||
        `sha256:${createHash("sha256").update(file.data).digest("hex")}` !== item.contentIdentity
      )
        throw new Error(`Workspace changed after review: ${item.path}`);
      const target = join(destination, item.path);
      await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
      guard();
      await writeFile(target, file.data, {
        flag: "wx",
        mode: file.mode,
        ...(signal ? { signal } : {}),
      });
      guard();
      await chmod(target, file.mode);
      guard();
    }
    guard();
    const finalReview = await discoverWorkspace(captured.root, exclusions, signal);
    try {
      guard();
      if (finalReview.identity !== captured.identity)
        throw new Error("Workspace changed during snapshot");
    } finally {
      await closeWorkspaceReview(finalReview);
    }
    return destination;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
