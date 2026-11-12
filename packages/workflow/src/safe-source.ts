import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** A live capability: closing it prevents any further source reads. */
export interface SafeSourceRoot {
  readonly dev: string;
  readonly ino: string;
  close(): Promise<void>;
}

const helper = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
  "dist/native/safe-source-helper",
);
const maxOutput = 256 * 1024 * 1024;
const handles = new WeakMap<SafeSourceRoot, FileHandle>();

class PinnedRoot implements SafeSourceRoot {
  constructor(
    readonly dev: string,
    readonly ino: string,
    handle: FileHandle,
  ) {
    handles.set(this, handle);
  }
  async close(): Promise<void> {
    const handle = handles.get(this);
    handles.delete(this);
    if (handle) await handle.close();
  }
}

function validateRoot(root: string): void {
  if (process.platform !== "linux") throw new Error("Secure source reading requires Linux openat2");
  if (!isAbsolute(root) || resolve(root) !== root || root.includes("\0")) {
    throw new Error("Source root must be an absolute normalized path");
  }
}

/** Pin a root opened atomically by the helper, keeping its inode alive until close(). */
export async function safeSourceRoot(root: string, signal?: AbortSignal): Promise<SafeSourceRoot> {
  validateRoot(root);
  signal?.throwIfAborted();
  const child = spawn(helper, ["root", root], { stdio: ["pipe", "pipe", "ignore"] });
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  // Attach before any await so termination cannot race the close listener.
  child.stdin.on("error", (error) => {
    spawnError = error;
  });
  const { promise: closed, resolve: closedResolve } = Promise.withResolvers<void>();
  child.once("close", () => closedResolve());
  const abort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let handle: FileHandle | undefined;
  let identity: { dev: string; ino: string } | undefined;
  try {
    const first = await lines.next();
    signal?.throwIfAborted();
    const match = !first.done && /^R (\d+) (\d+)$/.exec(first.value);
    if (!match || !child.pid) throw spawnError ?? new Error("Secure source root helper failed");
    // The helper keeps fd 3 open through the acknowledgement below. Matching
    // its inode while it is pinned prevents inode-reuse substitution here.
    handle = await open(`/proc/${child.pid}/fd/3`, constants.O_RDONLY | constants.O_DIRECTORY);
    const stat = await handle.stat({ bigint: true });
    if (
      !stat.isDirectory() ||
      stat.dev.toString() !== match[1] ||
      stat.ino.toString() !== match[2]
    ) {
      throw new Error("Secure source root handoff changed identity");
    }
    child.stdin.write("1");
    const acknowledgement = await lines.next();
    signal?.throwIfAborted();
    if (acknowledgement.done || acknowledgement.value !== "A")
      throw new Error("Secure source root handoff failed");
    identity = { dev: match[1]!, ino: match[2]! };
  } finally {
    signal?.removeEventListener("abort", abort);
    child.kill("SIGKILL");
    await closed;
    if (!identity) await handle?.close();
  }
  if (!identity || !handle) throw new Error("Secure source root handoff failed");
  if (signal?.aborted) {
    await handle.close();
    signal.throwIfAborted();
  }
  return new PinnedRoot(identity.dev, identity.ino, handle);
}

function invoke(args: string[], handle: FileHandle, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const { promise, resolve: resolveOutput, reject } = Promise.withResolvers<Buffer>();
  const child = spawn(helper, args, { stdio: ["ignore", "pipe", "pipe", handle.fd] });
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  let size = 0;
  let errorSize = 0;
  let failure: Error | undefined =
    !child.stdout || !child.stderr
      ? new Error("Secure source helper output pipes are unavailable")
      : undefined;
  child.stdout?.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxOutput) {
      failure = new Error("Secure source exceeds output limit");
      child.kill("SIGKILL");
    } else chunks.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    errorSize += chunk.length;
    if (errorSize <= 65536) errors.push(chunk);
  });
  child.on("error", (error) => {
    failure = error;
  });
  const abort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  child.once("close", (code, childSignal) => {
    signal?.removeEventListener("abort", abort);
    if (signal?.aborted) {
      try {
        signal.throwIfAborted();
      } catch (error) {
        reject(error);
      }
    } else if (failure) reject(failure);
    else if (code !== 0)
      reject(
        new Error(
          `Secure source helper failed (${childSignal ?? code}): ${Buffer.concat(errors).toString("utf8")}`,
        ),
      );
    else resolveOutput(Buffer.concat(chunks, size));
  });
  if (failure) child.kill("SIGKILL");
  return promise;
}

/** Read one explicitly selected path beneath the live, identified root. */
export async function readSafeSource(
  root: string,
  path: string,
  expectedRoot: SafeSourceRoot,
  signal?: AbortSignal,
): Promise<{ data: Buffer; mode: number } | null> {
  validateRoot(root);
  const handle = handles.get(expectedRoot);
  if (!handle || path.includes("\0")) throw new Error("Invalid or closed secure source root");
  const result = await invoke(
    ["read", root, expectedRoot.dev, expectedRoot.ino, path],
    handle,
    signal,
  );
  if (result.equals(Buffer.from("M\n"))) return null;
  const newline = result.indexOf(10);
  if (newline < 0 || newline > 16) throw new Error("Invalid secure source response");
  const match = /^F (\d+)$/.exec(result.subarray(0, newline).toString("ascii"));
  if (!match) throw new Error("Invalid secure source response");
  const mode = Number(match[1]);
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777)
    throw new Error("Invalid secure source mode");
  return { data: result.subarray(newline + 1), mode };
}
