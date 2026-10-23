import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CodeTarget } from "@lorelum/judge-protocol";
import { collectGitSource } from "./git.js";
import {
  byteIdentity,
  recordVerificationFailure,
  SourceChangedError,
  SourceCollector,
  sourceError,
  validRequest,
} from "./shared.js";
import type { SourceOptions, SourceReadRequest, SourceSession } from "./types.js";

export function isWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Reads raw regular-file bytes, never invoking a repository transform. */
export async function readLocalBytes(
  path: string,
  roots: readonly string[],
  collector: SourceCollector,
  verifying = false,
): Promise<{ bytes: Buffer; actual: string } | undefined> {
  if (collector.cancelled()) return;
  const actual = await realpath(path);
  if (!roots.some((root) => isWithinRoot(actual, root)))
    throw new Error("Real path is outside authorized roots");
  const handle = await open(
    actual,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("Source is not a regular file");
    if (!collector.reserveBytes(Number(before.size), path, verifying)) return;
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let count = 0;
    while (count < bytes.length) {
      if (collector.cancelled()) return;
      const result = await handle.read(bytes, count, bytes.length - count, count);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      (await realpath(path)) !== actual
    ) {
      collector.snapshot.consistent = false;
      collector.issue("source_changed", "File changed while reading", path);
    }
    return { bytes: bytes.subarray(0, count), actual };
  } finally {
    await handle.close();
  }
}

export async function collectLocalSource(
  target: Extract<CodeTarget, { kind: "local" }>,
  options: SourceOptions,
): Promise<SourceSession> {
  if (target.ref !== undefined)
    return collectGitSource(
      { kind: "git", path: target.path, selection: "commit", head: target.ref },
      options,
      true,
    );
  const collector = new SourceCollector(options);
  let base = "";
  let roots: string[] = [];
  const observed = new Map<string, string>();
  const directories = new Map<string, string>();
  let initialRead = true;
  const read = async (request: SourceReadRequest): Promise<void> => {
    if (!validRequest(collector, request) || !base) return;
    if (request.side && request.side !== "current") {
      collector.issue("side_unavailable", "Local source has only a current side", request.path);
      return;
    }
    const visit = async (path: string): Promise<void> => {
      if (
        collector.cancelled() ||
        !collector.discover(relative(base, path).split(sep).join("/") || ".")
      )
        return;
      try {
        const actual = await realpath(path);
        if (!roots.some((root) => isWithinRoot(actual, root)))
          throw new Error("Real path is outside authorized roots");
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
          collector.omit(path, "symlink", "Symbolic links are not traversed");
          return;
        }
        if (info.isDirectory()) {
          if (path !== base && path.endsWith(`${sep}.git`)) return;
          const before = await stat(actual, { bigint: true });
          const identity = `${before.dev}:${before.ino}:${before.mtimeNs}:${before.ctimeNs}`;
          const previous = directories.get(path);
          if (previous && previous !== identity) {
            collector.snapshot.consistent = false;
            collector.issue("source_changed", "Directory changed between enumerations", path);
          }
          if (!previous) directories.set(path, identity);
          const directory = await opendir(actual);
          for await (const entry of directory) {
            if (
              collector.cancelled() ||
              collector.snapshot.discovered.length >= collector.limits.maxEntries
            ) {
              collector.omit(path, "entry_limit", "Directory enumeration was not completed");
              break;
            }
            if (entry.name !== ".git") await visit(resolve(actual, entry.name));
          }
          return;
        }
        if (!info.isFile()) {
          collector.omit(path, "special_file", "Special files are not read");
          return;
        }
        if (request.kind === "list") return;
        const data = await readLocalBytes(path, roots, collector);
        if (!data) return;
        const identity = byteIdentity(data.bytes);
        const previous = observed.get(path);
        if (previous && previous !== identity) {
          collector.snapshot.consistent = false;
          collector.issue("source_changed", "File changed between reads", path);
        }
        observed.set(path, identity);
        collector.add({
          path: relative(base, path).split(sep).join("/"),
          bytes: data.bytes,
          version: identity,
          provenance: "local",
          role: initialRead ? "target" : "context",
          request,
        });
      } catch (error) {
        collector.omit(path, "local_unavailable", sourceError(error));
      }
    };
    const path = resolve(base, request.path);
    if (!roots.some((root) => isWithinRoot(path, root))) {
      collector.issue("outside_root", "Requested path is outside authorized roots", request.path);
      return;
    }
    await visit(path);
  };
  try {
    if (collector.request()) {
      const actual = await realpath(target.path);
      const info = await lstat(actual);
      base = info.isDirectory() ? actual : dirname(actual);
      roots = options.roots
        ? await Promise.all(options.roots.map((root) => realpath(root)))
        : [actual];
      if (!roots.some((root) => isWithinRoot(actual, root)))
        throw new Error("Target is outside authorized roots");
      await read({ kind: "read", path: relative(base, actual) || "." });
      initialRead = false;
    }
  } catch (error) {
    collector.issue("local_unavailable", sourceError(error), target.path, true);
  }
  return {
    snapshot: collector.snapshot,
    read,
    async verify() {
      if (!collector.beginVerification()) return;
      for (const [path, identity] of observed) {
        try {
          const data = await readLocalBytes(path, roots, collector, true);
          if (data === undefined) continue;
          if (byteIdentity(data.bytes) !== identity)
            throw new SourceChangedError("File bytes changed after collection");
        } catch (error) {
          recordVerificationFailure(collector, error, path);
        }
      }
      for (const [path, identity] of directories) {
        try {
          const info = await stat(path, { bigint: true });
          if (`${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}` !== identity)
            throw new SourceChangedError("Directory changed after enumeration");
        } catch (error) {
          recordVerificationFailure(collector, error, path);
        }
      }
    },
  };
}
