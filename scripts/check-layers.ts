import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { init, parse } from "es-module-lexer";

await init;

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PackageDependencyPolicy {
  readonly runtime: readonly string[];
  readonly test: readonly string[];
}

interface WorkspacePackage {
  readonly directory: string;
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

type ImportScope = "runtime" | "test";

const corePolicies: Readonly<Record<string, PackageDependencyPolicy>> = {
  "@lorelum/judge-protocol": {
    runtime: [],
    test: [],
  },
  "@lorelum/judge-runtime": {
    runtime: ["@lorelum/judge-protocol"],
    test: ["@lorelum/judge-protocol"],
  },
  "@lorelum/judge": {
    runtime: ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
    test: ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
  },
  "@lorelum/judge-workflow": {
    runtime: ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge"],
    test: [
      "@lorelum/judge-protocol",
      "@lorelum/judge-runtime",
      "@lorelum/judge",
      "@lorelum/judge-testing",
    ],
  },
  "@lorelum/judge-testing": {
    runtime: ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge"],
    test: ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge"],
  },
  "@lorelum/judge-adapters": {
    runtime: ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
    test: ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge-testing"],
  },
  "@lorelum/judge-cli": {
    runtime: [
      "@lorelum/judge-protocol",
      "@lorelum/judge-runtime",
      "@lorelum/judge",
      "@lorelum/judge-workflow",
      "@lorelum/judge-adapters",
    ],
    test: [
      "@lorelum/judge-protocol",
      "@lorelum/judge-runtime",
      "@lorelum/judge",
      "@lorelum/judge-workflow",
      "@lorelum/judge-adapters",
      "@lorelum/judge-testing",
    ],
  },
};

function policyFor(packageName: string): PackageDependencyPolicy | undefined {
  if (packageName.startsWith("@lorelum/runtime-")) {
    return {
      runtime: ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
      test: ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge-testing"],
    };
  }
  if (packageName.startsWith("@lorelum/provider-")) {
    return {
      runtime: ["@lorelum/judge-protocol", "@lorelum/judge-runtime"],
      test: ["@lorelum/judge-protocol", "@lorelum/judge-runtime", "@lorelum/judge-testing"],
    };
  }
  return corePolicies[packageName];
}

export function allowedDependenciesFor(packageName: string): readonly string[] | undefined {
  return policyFor(packageName)?.runtime;
}

export function allowedTestDependenciesFor(packageName: string): readonly string[] | undefined {
  return policyFor(packageName)?.test;
}

export function isAllowedDependency(sourcePackage: string, targetPackage: string): boolean {
  return allowedDependenciesFor(sourcePackage)?.includes(targetPackage) ?? false;
}

export function isAllowedTestDependency(sourcePackage: string, targetPackage: string): boolean {
  return allowedTestDependenciesFor(sourcePackage)?.includes(targetPackage) ?? false;
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
          devDependencies?: Record<string, string>;
        };
        return {
          directory,
          name: manifest.name,
          dependencies: manifest.dependencies ?? {},
          devDependencies: manifest.devDependencies ?? {},
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

function packageByName(
  name: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  return packages.find((pkg) => pkg.name === name);
}

function recordFailure(
  failures: string[],
  source: WorkspacePackage,
  target: WorkspacePackage,
  reason: string,
): void {
  failures.push(`${source.name} -> ${target.name}: ${reason}`);
}

function checkDeclaredDependencies(
  source: WorkspacePackage,
  packages: readonly WorkspacePackage[],
  policy: PackageDependencyPolicy,
  failures: string[],
): void {
  for (const dependency of Object.keys(source.dependencies)) {
    const target = packageByName(dependency, packages);
    if (target !== undefined && !policy.runtime.includes(target.name)) {
      recordFailure(
        failures,
        source,
        target,
        "runtime dependency is not allowed; test kit may only be a package-local test dependency",
      );
    }
  }

  for (const dependency of Object.keys(source.devDependencies)) {
    const target = packageByName(dependency, packages);
    if (target !== undefined && !policy.test.includes(target.name)) {
      recordFailure(failures, source, target, "test dependency is not allowed");
    }
  }
}

function checkImports(
  source: WorkspacePackage,
  packages: readonly WorkspacePackage[],
  policy: PackageDependencyPolicy,
  scope: ImportScope,
  failures: string[],
): void {
  const files = listTypeScriptFiles(join(source.directory, scope === "runtime" ? "src" : "test"));
  const allowed = scope === "runtime" ? policy.runtime : policy.test;

  for (const file of files) {
    for (const specifier of moduleSpecifiers(file)) {
      const target = specifier.startsWith(".")
        ? packageForPath(resolve(dirname(file), specifier), packages)
        : packageForSpecifier(specifier, packages);

      if (target === undefined || target.name === source.name) {
        if (target === undefined && specifier.startsWith(".")) {
          failures.push(`${source.name}: relative import escapes every workspace package: ${file}`);
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
        recordFailure(
          failures,
          source,
          target,
          `${scope} import is not allowed by the package policy`,
        );
        continue;
      }

      const declaredInEitherScope =
        source.dependencies[target.name] === "workspace:*" ||
        source.devDependencies[target.name] === "workspace:*";
      const declaredInAllowedScope =
        scope === "runtime"
          ? source.dependencies[target.name] === "workspace:*"
          : declaredInEitherScope;

      if (!declaredInAllowedScope) {
        recordFailure(
          failures,
          source,
          target,
          scope === "runtime"
            ? "runtime import is not declared in dependencies with workspace:*"
            : "test import is not declared in devDependencies or dependencies with workspace:*",
        );
      }
    }
  }
}

export function checkWorkspace(repositoryRoot = defaultRepositoryRoot): readonly string[] {
  const failures: string[] = [];
  const packages = readWorkspacePackages(repositoryRoot);

  for (const source of packages) {
    const policy = policyFor(source.name);
    if (policy === undefined) {
      failures.push(`No package dependency policy is defined for ${source.name}.`);
      continue;
    }

    checkDeclaredDependencies(source, packages, policy, failures);
    checkImports(source, packages, policy, "runtime", failures);
    checkImports(source, packages, policy, "test", failures);
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
