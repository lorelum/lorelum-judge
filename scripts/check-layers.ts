import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { init, parse } from "es-module-lexer";

await init;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoots = [join(repoRoot, "packages"), join(repoRoot, "apps")];

const allowedPackageDependencies: Readonly<Record<string, readonly string[]>> = {
  "@lorelum/judge-protocol": [],
  "@lorelum/judge-runtime": ["@lorelum/judge-protocol"],
  "@lorelum/judge": ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
  "@lorelum/judge-workflow": [
    "@lorelum/judge-protocol",
    "@lorelum/judge-runtime",
    "@lorelum/judge",
  ],
  "@lorelum/judge-testing": ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge"],
  "@lorelum/judge-adapters": ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
  "@lorelum/judge-cli": [
    "@lorelum/judge-protocol",
    "@lorelum/judge-runtime",
    "@lorelum/judge",
    "@lorelum/judge-workflow",
    "@lorelum/judge-adapters",
  ],
};

function allowedDependenciesFor(packageName: string): readonly string[] | undefined {
  if (packageName.startsWith("@lorelum/runtime-")) {
    return ["@lorelum/judge-protocol", "@lorelum/judge-runtime"];
  }
  if (packageName.startsWith("@lorelum/provider-")) {
    return ["@lorelum/judge-protocol", "@lorelum/judge-runtime"];
  }
  return allowedPackageDependencies[packageName];
}

interface WorkspacePackage {
  readonly directory: string;
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

const failures: string[] = [];

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

function moduleSpecifiers(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const [imports] = parse(source);

  return imports.flatMap((entry) => (entry.n === undefined ? [] : [entry.n]));
}

function readWorkspacePackages(): WorkspacePackage[] {
  return workspaceRoots.flatMap((workspaceRoot) =>
    readdirSync(workspaceRoot)
      .map((entry) => join(workspaceRoot, entry))
      .filter((path) => statSync(path).isDirectory())
      .filter((path) => statSync(join(path, "package.json"), { throwIfNoEntry: false })?.isFile())
      .map((directory) => {
        const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
          name: string;
          dependencies?: Record<string, string>;
        };
        return {
          directory,
          name: manifest.name,
          dependencies: manifest.dependencies ?? {},
        };
      }),
  );
}

function packageForPath(path: string, packages: readonly WorkspacePackage[]) {
  return packages.find((pkg) => {
    const relativePath = relative(pkg.directory, path);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  });
}

function packageForSpecifier(
  specifier: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  return packages.find((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`));
}

function recordFailure(source: WorkspacePackage, target: WorkspacePackage, reason: string): void {
  failures.push(`${source.name} -> ${target.name}: ${reason}`);
}

const packages = readWorkspacePackages();

for (const source of packages) {
  const allowed = allowedDependenciesFor(source.name);
  if (allowed === undefined) {
    failures.push(`No package dependency policy is defined for ${source.name}.`);
    continue;
  }

  const sourceDirectory = join(source.directory, "src");
  if (!statSync(sourceDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    continue;
  }

  for (const file of listTypeScriptFiles(sourceDirectory)) {
    for (const specifier of moduleSpecifiers(file)) {
      const target = specifier.startsWith(".")
        ? packageForPath(resolve(dirname(file), specifier), packages)
        : packageForSpecifier(specifier, packages);

      if (target === undefined || target.name === source.name) {
        continue;
      }

      if (specifier.startsWith(".")) {
        recordFailure(source, target, "relative imports may not cross package boundaries");
        continue;
      }

      if (!allowed.includes(target.name)) {
        recordFailure(source, target, "package dependency is not allowed");
        continue;
      }

      if (source.dependencies[target.name] !== "workspace:*") {
        recordFailure(source, target, "workspace dependency is not declared in package.json");
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Workspace package dependencies are valid.\n");
}
