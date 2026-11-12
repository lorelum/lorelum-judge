import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const within = (parent: string, child: string): boolean =>
  child === parent || child.startsWith(parent === "/" ? "/" : `${parent}/`);

function decodeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

async function mountPoints(checkpoint?: () => void): Promise<string[]> {
  checkpoint?.();
  const text = await readFile("/proc/self/mountinfo", "utf8");
  checkpoint?.();
  return text
    .trimEnd()
    .split("\n")
    .map((line) => {
      const separator = line.indexOf(" - ");
      const fields = line.slice(0, separator).split(" ");
      if (separator < 0 || fields.length < 6 || !fields[3] || !fields[4]) {
        throw new Error("Cannot verify Linux mount topology");
      }
      return decodeMountField(fields[4]);
    });
}

export async function rejectMountedSubtrees(
  root: string,
  maskedSubtrees: readonly string[] = [],
  checkpoint?: () => void,
): Promise<void> {
  const mounts = await mountPoints(checkpoint);
  for (const mount of mounts) {
    checkpoint?.();
    if (within(root, mount) && !maskedSubtrees.some((masked) => within(masked, mount))) {
      throw new Error(`Sandbox path intersects a mount or bind mount: ${mount}`);
    }
  }
  for (const mount of mounts) {
    checkpoint?.();
    if (mount !== "/" && within(mount, root)) {
      throw new Error(`Sandbox path intersects a mount or bind mount: ${mount}`);
    }
  }
}

/** Scan trusted directories; opaque, untrusted child directories must be masked. */
export async function validateToolchainEntries(
  root: string,
  trustedUid: number,
  maskedSubtrees: readonly string[] = [],
  checkpoint?: () => void,
): Promise<string[]> {
  const unsafeDirectories: string[] = [];
  const visit = async (entry: string): Promise<void> => {
    checkpoint?.();
    const stat = await lstat(entry);
    checkpoint?.();
    if (maskedSubtrees.includes(entry) && !stat.isDirectory()) {
      throw new Error(`Masked toolchain path is not a real directory: ${entry}`);
    }
    if (stat.isSocket()) throw new Error(`Toolchain contains a Unix socket: ${entry}`);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (stat.uid !== trustedUid || (stat.mode & 0o022) !== 0) {
        throw new Error(`Toolchain file is not administrator-controlled: ${entry}`);
      }
      return;
    }
    if (!stat.isDirectory()) throw new Error(`Toolchain contains a special file: ${entry}`);
    if (maskedSubtrees.includes(entry)) return;
    if (stat.uid !== trustedUid || (stat.mode & 0o022) !== 0) {
      if (entry === root)
        throw new Error(`Toolchain root is not administrator-controlled: ${entry}`);
      unsafeDirectories.push(entry);
      return;
    }
    for (const child of await readdir(entry, { withFileTypes: true })) {
      checkpoint?.();
      // Links are resolved only inside the constrained sandbox filesystem.
      if (!child.isSymbolicLink()) await visit(path.join(entry, child.name));
    }
  };
  await visit(root);
  checkpoint?.();
  return unsafeDirectories;
}

export async function validateToolchain(
  root: string,
  trustedUid: number,
  checkpoint?: () => void,
): Promise<string[]> {
  checkpoint?.();
  if ((await realpath(root)) !== root) throw new Error("Toolchain root must be canonical");
  checkpoint?.();
  let ancestor = root;
  while (true) {
    checkpoint?.();
    const stat = await lstat(ancestor);
    checkpoint?.();
    if (!stat.isDirectory() || stat.uid !== trustedUid || (stat.mode & 0o022) !== 0) {
      throw new Error(`Toolchain ancestor is not administrator-controlled: ${ancestor}`);
    }
    if (ancestor === "/") break;
    ancestor = path.dirname(ancestor);
  }
  const candidates = (await mountPoints(checkpoint)).filter(
    (point) => point !== root && within(root, point),
  );
  candidates.sort((a, b) => a.length - b.length);
  const maskedSubtrees: string[] = [];
  for (const candidate of candidates) {
    checkpoint?.();
    if (maskedSubtrees.some((masked) => within(masked, candidate))) continue;
    const stat = await lstat(candidate);
    checkpoint?.();
    if (!stat.isDirectory()) {
      throw new Error(`Mounted toolchain path cannot be safely masked: ${candidate}`);
    }
    maskedSubtrees.push(candidate);
  }
  await rejectMountedSubtrees(root, maskedSubtrees, checkpoint);
  maskedSubtrees.push(
    ...(await validateToolchainEntries(root, trustedUid, maskedSubtrees, checkpoint)),
  );
  checkpoint?.();
  return maskedSubtrees;
}
