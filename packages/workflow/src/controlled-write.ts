import { createHash, randomUUID } from "node:crypto";
import { constants, renameSync } from "node:fs";
import { chmod, lstat, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

function contentIdentity(data: Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Stage privately, then recheck authorization and the old bytes immediately before atomic commit. */
export async function writeAuthorizedFile(options: {
  readonly target: string;
  readonly expectedIdentity: string | null;
  readonly content: Buffer;
  readonly guard: () => void;
  readonly signal: AbortSignal;
  readonly resolveTarget: () => Promise<string>;
}): Promise<void> {
  const { target, expectedIdentity, content, guard, signal, resolveTarget } = options;
  guard();
  const previous = await readOptional(target);
  guard();
  if ((previous === null ? null : contentIdentity(previous)) !== expectedIdentity) {
    throw new Error("Write precondition changed");
  }
  const mode = previous === null ? 0o600 : (await lstat(target)).mode & 0o777;
  guard();
  const temporary = join(dirname(target), `.lorelum-write-${randomUUID()}`);
  let created = false;
  try {
    guard();
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    try {
      guard();
      await handle.writeFile(content, { signal });
    } finally {
      await handle.close();
    }
    guard();
    await chmod(temporary, mode);
    guard();
    const currentTarget = await resolveTarget();
    const current = await readOptional(currentTarget);
    guard();
    if ((current === null ? null : contentIdentity(current)) !== expectedIdentity) {
      throw new Error("Write precondition changed");
    }
    // Authorization cannot change on this event loop between this guard and the syscall.
    guard();
    renameSync(temporary, currentTarget);
    created = false;
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}
