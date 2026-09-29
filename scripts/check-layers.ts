import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { init, parse } from "es-module-lexer";

await init;

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

interface WorkspacePackage {
  readonly directory: string;
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

export function allowedDependenciesFor(packageName: string): readonly string[] | undefined {
  if (packageName.startsWith("@lorelum/runtime-")) {
    return ["@lorelum/judge-protocol", "@lorelum/judge-runtime"];
  }
  if (packageName.startsWith("@lorelum/provider-")) {
    return ["@lorelum/judge-protocol", "@lorelum/judge-runtime"];
  }
  return allowedPackageDependencies[packageName];
}

export function isAllowedDependency(sourcePackage: string, targetPackage: string): boolean {
  return allowedDependenciesFor(sourcePackage)?.includes(targetPackage) ?? false;
}

function listTypeScriptFiles(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }

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

function readWorkspacePackages(repositoryRoot: string): WorkspacePackage[] {
  const workspaceRoots = [join(repositoryRoot, "packages"), join(repositoryRoot, "apps")];

  return workspaceRoots.flatMap((workspaceRoot) =>
    (statSync(workspaceRoot, { throwIfNoEntry: false })?.isDirectory()
      ? readdirSync(workspaceRoot)
      : []
    )
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

function recordFailure(
  failures: string[],
  source: WorkspacePackage,
  target: WorkspacePackage,
  reason: string,
): void {
  failures.push(`${source.name} -> ${target.name}: ${reason}`);
}

export function checkWorkspace(repositoryRoot = defaultRepositoryRoot): readonly string[] {
  const failures: string[] = [];
  const packages = readWorkspacePackages(repositoryRoot);

  for (const source of packages) {
    const allowed = allowedDependenciesFor(source.name);
    if (allowed === undefined) {
      failures.push(`No package dependency policy is defined for ${source.name}.`);
      continue;
    }

    for (const file of listTypeScriptFiles(join(source.directory, "src"))) {
      for (const specifier of moduleSpecifiers(file)) {
        const target = specifier.startsWith(".")
          ? packageForPath(resolve(dirname(file), specifier), packages)
          : packageForSpecifier(specifier, packages);

        if (target === undefined || target.name === source.name) {
          if (target === undefined && specifier.startsWith(".")) {
            failures.push(
              `${source.name}: relative import escapes every workspace package: ${file}`,
            );
          }
          continue;
        }

        if (specifier.startsWith(".")) {
          recordFailure(
            failures,
            source,
            target,
            "relative imports may not cross package boundaries",
          );
          continue;
        }

        if (!allowed.includes(target.name)) {
          recordFailure(failures, source, target, "package dependency is not allowed");
          continue;
        }

        if (source.dependencies[target.name] !== "workspace:*") {
          recordFailure(
            failures,
            source,
            target,
            "workspace dependency is not declared in package.json",
          );
        }
      }
    }
  }

  return failures;
}

if (import.meta.main) {
  const failures = checkWorkspace();
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Workspace package dependencies are valid.\n");
  }
}
