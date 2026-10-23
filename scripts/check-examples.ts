import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the examples as an isolated Node ESM consumer. The temporary directory has
 * only the built workspace packages under `node_modules/@lorelum`; imports therefore
 * resolve through each package's public `exports.import` entry, never `src`.
 */
const repositoryRoot = resolve(import.meta.dir, "..");
const sourceDirectory = join(repositoryRoot, "examples/consumer");
const temporaryRoot = mkdtempSync(join(tmpdir(), "lorelum-examples-"));
const consumerDirectory = join(temporaryRoot, "consumer");
const modulesDirectory = join(temporaryRoot, "node_modules/@lorelum");

try {
  mkdirSync(consumerDirectory, { recursive: true });
  for (const file of readdirSync(sourceDirectory)) {
    if (file.endsWith(".js") || file === "package.json") {
      copyFileSync(join(sourceDirectory, file), join(consumerDirectory, file));
    }
  }

  mkdirSync(modulesDirectory, { recursive: true });
  for (const directory of readdirSync(join(repositoryRoot, "packages"))) {
    const packageDirectory = join(repositoryRoot, "packages", directory);
    if (!statSync(packageDirectory).isDirectory()) continue;
    const manifestPath = join(packageDirectory, "package.json");
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("name" in manifest) ||
      typeof manifest.name !== "string" ||
      !manifest.name.startsWith("@lorelum/")
    ) {
      continue;
    }
    symlinkSync(
      packageDirectory,
      join(modulesDirectory, manifest.name.slice("@lorelum/".length)),
      "junction",
    );
  }

  execFileSync("node", [join(consumerDirectory, "run.js")], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
