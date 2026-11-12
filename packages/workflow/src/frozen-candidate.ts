import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityOf } from "@lorelum/judge-protocol";

export interface FrozenCandidate {
  readonly root: string;
  readonly identity: string;
  readonly files: readonly {
    readonly path: string;
    readonly identity: string;
    readonly mode: number;
  }[];
}

/** Render the actual byte changes; binary files are reported without fabricating text. */
export async function renderCandidateDiff(
  baseline: ReadonlyMap<string, Uint8Array>,
  candidate: FrozenCandidate,
  guard: () => void,
): Promise<string> {
  const current = new Map(candidate.files.map((file) => [file.path, file]));
  const paths = [...new Set([...baseline.keys(), ...current.keys()])].sort();
  const sections: string[] = [];
  for (const path of paths) {
    guard();
    const before = baseline.get(path);
    const file = current.get(path);
    const after = file ? await readFile(join(candidate.root, path)) : undefined;
    guard();
    if (
      file &&
      (!after || `sha256:${createHash("sha256").update(after).digest("hex")}` !== file.identity)
    )
      throw new Error(`Frozen candidate changed: ${path}`);
    if (before && after && Buffer.from(before).equals(after)) continue;
    const title = `--- ${JSON.stringify(path)}\n+++ ${JSON.stringify(path)}`;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const oldText = before ? decoder.decode(before) : "";
      const newText = after ? decoder.decode(after) : "";
      if (oldText.includes("\0") || newText.includes("\0")) throw new Error("binary");
      sections.push(
        `${title}\n${oldText
          .split("\n")
          .map((line) => `-${line}`)
          .join("\n")}\n${newText
          .split("\n")
          .map((line) => `+${line}`)
          .join("\n")}`,
      );
    } catch {
      sections.push(`${title}\nBinary content changed`);
    }
  }
  return sections.join("\n");
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
