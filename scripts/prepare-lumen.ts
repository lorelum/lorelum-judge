import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");
const cache = resolve(repository, ".lumen-cache");
const source = resolve(cache, "source");
const revision = "b95a5409bfaba0e0f8db65c7a82257425f2ca99e";
const git = (args: string[], cwd: string) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error("Unable to access the pinned LumenUI source");
  return result.stdout.toString().trim();
};
const bun = (args: string[], cwd: string) => {
  const result = Bun.spawnSync([process.execPath, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error("Unable to build the pinned LumenUI package");
};
await mkdir(cache, { recursive: true });
const existing = await stat(source).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (!existing) {
  git(["clone", "--no-checkout", "https://github.com/lorelum/lumen-ui.git", source], cache);
  git(["checkout", "--detach", revision], source);
} else {
  if (
    !existing.isDirectory() ||
    git(["rev-parse", "HEAD"], source) !== revision ||
    git(["status", "--porcelain"], source)
  ) {
    throw new Error("Existing LumenUI source is not a clean checkout of the pinned revision");
  }
}
bun(["install", "--frozen-lockfile"], source);
bun(["run", "--cwd", "packages/theme", "build"], source);
bun(["run", "--cwd", "packages/ui", "build"], source);
const ui = resolve(source, "packages/ui");
const prepared = resolve(cache, "lumen-ui-package");
const manifest = JSON.parse(await readFile(resolve(ui, "package.json"), "utf8"));
delete manifest.devDependencies;
await rm(prepared, { recursive: true, force: true });
await mkdir(prepared, { recursive: true });
for (const path of ["dist", "registry", "README.md", "THIRD_PARTY_NOTICES.md"]) {
  await cp(resolve(ui, path), resolve(prepared, path), { recursive: true });
}
await writeFile(resolve(prepared, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
