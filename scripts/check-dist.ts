import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dir, "..");
const workspaceRoots = ["packages", "apps"] as const;

interface PackageManifest {
  readonly name?: string;
  readonly exports?: {
    readonly "."?:
      | string
      | {
          readonly import?: string;
        };
  };
}

function packageDirectories(): string[] {
  return workspaceRoots.flatMap((workspaceRoot) => {
    const root = join(repositoryRoot, workspaceRoot);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      return [];
    }

    return readdirSync(root)
      .map((entry) => join(root, entry))
      .filter((directory) => statSync(directory).isDirectory())
      .filter((directory) => statSync(join(directory, "package.json")).isFile());
  });
}

function importTarget(directory: string): string | undefined {
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as
    | PackageManifest
    | undefined;
  const rootExport = manifest?.exports?.["."];

  if (typeof rootExport === "string") {
    return rootExport;
  }
  return rootExport?.import;
}

const targets = packageDirectories().flatMap((directory) => {
  const target = importTarget(directory);
  return target === undefined ? [] : [{ directory, target }];
});

for (const { directory, target } of targets) {
  const entrypoint = pathToFileURL(resolve(directory, target)).href;
  execFileSync(
    "node",
    ["--input-type=module", "--eval", `await import(${JSON.stringify(entrypoint)});`],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
}

process.stdout.write(`Loaded ${targets.length} built package exports in Node ESM.\n`);
