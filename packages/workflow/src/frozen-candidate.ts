import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityOf } from "@lorelum/judge-protocol";
import { readSafeSource, type SafeSourceRoot, safeSourceRoot } from "./safe-source.js";

export interface FrozenCandidate {
  readonly root: string;
  readonly identity: string;
  readonly files: readonly {
    readonly path: string;
    readonly identity: string;
    readonly mode: number;
  }[];
}
export interface BaselineFile {
  readonly data: Uint8Array;
  readonly mode: number;
}

export interface DiagnosticBudget {
  readonly signal: AbortSignal;
  remainingBytes: number;
  remainingEntries: number;
}

function consumeDiagnosticBytes(budget: DiagnosticBudget | undefined, count: number): void {
  if (!budget) return;
  budget.signal.throwIfAborted();
  if (!Number.isSafeInteger(count) || count < 0 || count > budget.remainingBytes)
    throw new Error("Diagnostic byte limit exceeded");
  budget.remainingBytes -= count;
}

async function boundedSourceRead(
  root: string,
  path: string,
  pinned: SafeSourceRoot,
  budget?: DiagnosticBudget,
) {
  budget?.signal.throwIfAborted();
  if (budget && budget.remainingBytes < 32) throw new Error("Diagnostic byte limit exceeded");
  const result = await readSafeSource(
    root,
    path,
    pinned,
    budget?.signal,
    budget ? budget.remainingBytes - 32 : undefined,
  );
  if (budget) consumeDiagnosticBytes(budget, (result?.data.byteLength ?? 0) + 32);
  return result;
}

/** Render the actual byte changes; binary files are reported without fabricating text. */
export async function renderCandidateDiff(
  baseline: ReadonlyMap<string, BaselineFile>,
  candidate: FrozenCandidate,
  guard?: () => void,
  diagnostic?: DiagnosticBudget,
): Promise<string> {
  guard?.();
  const pinned = await safeSourceRoot(candidate.root, diagnostic?.signal);
  try {
    if (diagnostic) {
      const count = baseline.size + candidate.files.length;
      if (count > diagnostic.remainingEntries) throw new Error("Diagnostic entry limit exceeded");
      diagnostic.remainingEntries -= count;
    }
    const current = new Map(candidate.files.map((file) => [file.path, file]));
    const paths = [...new Set([...baseline.keys(), ...current.keys()])].sort();
    const sections: string[] = [];
    for (const path of paths) {
      diagnostic?.signal.throwIfAborted();
      guard?.();
      const before = baseline.get(path);
      const file = current.get(path);
      const content = file
        ? await boundedSourceRead(candidate.root, path, pinned, diagnostic)
        : null;
      const after = content?.data;
      guard?.();
      if (
        file &&
        (!content ||
          content.mode !== file.mode ||
          `sha256:${createHash("sha256").update(content.data).digest("hex")}` !== file.identity)
      )
        throw new Error(`Frozen candidate changed: ${path}`);
      if (before) consumeDiagnosticBytes(diagnostic, before.data.byteLength);
      const sameBytes =
        before !== undefined && after !== undefined && Buffer.compare(before.data, after) === 0;
      const sameMode = before?.mode === file?.mode;
      if (sameBytes && sameMode) continue;
      const title = `--- ${JSON.stringify(path)}\n+++ ${JSON.stringify(path)}\nold mode ${before ? before.mode.toString(8).padStart(3, "0") : "absent"}\nnew mode ${file ? file.mode.toString(8).padStart(3, "0") : "absent"}`;
      if (sameBytes) {
        consumeDiagnosticBytes(diagnostic, Buffer.byteLength(title, "utf8") + 1);
        sections.push(title);
        continue;
      }
      let section: string;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const oldText = before ? decoder.decode(before.data) : "";
        const newText = after ? decoder.decode(after) : "";
        if (oldText.includes("\0") || newText.includes("\0")) throw new Error("binary");
        section = `${title}\n${oldText.replace(/^/gm, "-")}\n${newText.replace(/^/gm, "+")}`;
      } catch {
        section = `${title}\nBinary content changed`;
      }
      consumeDiagnosticBytes(diagnostic, Buffer.byteLength(section, "utf8") + 1);
      sections.push(section);
    }
    return sections.join("\n");
  } finally {
    await pinned.close();
  }
}

/** Inspect only a stopped, host-private candidate; failures never imply an empty diff. */
async function inspectStoppedCandidate(
  root: string,
  diagnostic: DiagnosticBudget,
): Promise<FrozenCandidate> {
  diagnostic?.signal.throwIfAborted();
  if ((await realpath(root)) !== root) throw new Error("Candidate root is not canonical");
  const rootStat = await lstat(root);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && rootStat.uid !== process.getuid())
  ) {
    throw new Error("Candidate root is not a private owned directory");
  }
  const pinned = await safeSourceRoot(root, diagnostic?.signal);
  try {
    const files: { path: string; identity: string; mode: number }[] = [];
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries: string[] = [];
      const dir = await opendir(directory);
      for await (const entry of dir) {
        diagnostic?.signal.throwIfAborted();
        if (diagnostic && --diagnostic.remainingEntries < 0)
          throw new Error("Diagnostic entry limit exceeded");
        consumeDiagnosticBytes(diagnostic, Buffer.byteLength(entry.name, "utf8"));
        entries.push(entry.name);
      }
      entries.sort();
      for (const name of entries) {
        diagnostic?.signal.throwIfAborted();
        if (name.toLowerCase() === ".git" || name.includes("\\"))
          throw new Error("Unsupported candidate path");
        const path = prefix ? `${prefix}/${name}` : name;
        const source = join(directory, name);
        const entry = await lstat(source);
        if (diagnostic && entry.isFile() && entry.size > diagnostic.remainingBytes)
          throw new Error("Diagnostic byte limit exceeded");
        if (entry.isSymbolicLink() || entry.dev !== rootStat.dev)
          throw new Error(`Unsupported candidate entry: ${path}`);
        if (entry.isDirectory()) {
          await visit(source, path);
        } else if (entry.isFile() && entry.nlink === 1) {
          const content = await boundedSourceRead(root, path, pinned, diagnostic);
          if (!content || content.mode !== (entry.mode & 0o777))
            throw new Error(`Candidate changed while reporting: ${path}`);
          const data = content.data;
          const after = await lstat(source);
          if (
            !after.isFile() ||
            after.nlink !== 1 ||
            after.dev !== entry.dev ||
            after.ino !== entry.ino ||
            after.size !== entry.size ||
            after.mode !== entry.mode ||
            after.mtimeMs !== entry.mtimeMs ||
            after.ctimeMs !== entry.ctimeMs
          )
            throw new Error(`Candidate changed while reporting: ${path}`);
          files.push({
            path,
            identity: `sha256:${createHash("sha256").update(data).digest("hex")}`,
            mode: entry.mode & 0o777,
          });
        } else throw new Error(`Unsupported candidate entry: ${path}`);
      }
    };
    await visit(root, "");
    const identity = identityOf("workflow-frozen-candidate/v1", files);
    if (!identity.ok) throw new Error("Cannot identify stopped candidate");
    return { root, identity: identity.identity, files };
  } finally {
    await pinned.close();
  }
}

/** Bounded, local-only reporting after the task has stopped. */
export async function collectFailureDiff(
  root: string,
  baseline: ReadonlyMap<string, BaselineFile>,
  limits: { readonly timeMs?: number; readonly bytes?: number; readonly entries?: number } = {},
): Promise<string> {
  const timeMs = limits.timeMs ?? 2000;
  const bytes = limits.bytes ?? 4 * 1024 * 1024;
  const entries = limits.entries ?? 4096;
  if (
    !Number.isSafeInteger(timeMs) ||
    timeMs < 0 ||
    timeMs > 2000 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > 4 * 1024 * 1024 ||
    !Number.isSafeInteger(entries) ||
    entries < 0 ||
    entries > 4096
  )
    throw new Error("Invalid diagnostic limits");
  if (timeMs === 0) throw new Error("Diagnostic time limit exceeded");
  const controller = new AbortController();
  const budget: DiagnosticBudget = {
    signal: controller.signal,
    remainingBytes: bytes,
    remainingEntries: entries,
  };
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    controller.abort();
    reject(new Error("Diagnostic time limit exceeded"));
  }, timeMs);
  try {
    const work = (async () => {
      const candidate = await inspectStoppedCandidate(root, budget);
      return renderCandidateDiff(baseline, candidate, undefined, budget);
    })();
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
/** Copy and identify a stopped implementer's private tree, rejecting unsupported entries. */
export async function freezeCandidate(root: string, guard: () => void): Promise<FrozenCandidate> {
  guard();
  if ((await realpath(root)) !== root) throw new Error("Candidate root is not canonical");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Invalid candidate root");
  const destination = await mkdtemp(join(await realpath(tmpdir()), "lorelum-runner-"));
  const files: { path: string; identity: string; mode: number }[] = [];
  try {
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory);
      entries.sort();
      for (const name of entries) {
        guard();
        if (name.toLowerCase() === ".git" || name === "." || name === ".." || name.includes("\\"))
          throw new Error("Unsupported candidate path");
        const path = prefix ? `${prefix}/${name}` : name;
        const source = join(directory, name);
        const entry = await lstat(source);
        if (entry.isSymbolicLink() || entry.dev !== rootStat.dev)
          throw new Error(`Unsupported candidate entry: ${path}`);
        if (entry.isDirectory()) {
          await mkdir(join(destination, path), { mode: 0o700 });
          await visit(source, path);
        } else if (entry.isFile() && entry.nlink === 1) {
          const data = await readFile(source);
          guard();
          const after = await lstat(source);
          if (
            after.ino !== entry.ino ||
            after.size !== entry.size ||
            after.mtimeMs !== entry.mtimeMs ||
            !after.isFile() ||
            after.nlink !== 1
          )
            throw new Error(`Candidate changed: ${path}`);
          const mode = entry.mode & 0o777;
          await writeFile(join(destination, path), data, { flag: "wx", mode });
          await chmod(join(destination, path), mode);
          files.push({
            path,
            identity: `sha256:${createHash("sha256").update(data).digest("hex")}`,
            mode,
          });
        } else throw new Error(`Unsupported candidate entry: ${path}`);
      }
    };
    await visit(root, "");
    guard();
    const identity = identityOf("workflow-frozen-candidate/v1", files);
    if (!identity.ok) throw new Error("Cannot identify candidate");
    return { root: destination, identity: identity.identity, files };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
