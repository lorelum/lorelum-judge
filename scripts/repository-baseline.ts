import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

const requiredFiles = [
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/validate.yml",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "biome.json",
  "bun.lock",
  "package.json",
  "tsconfig.base.json",
  "tsconfig.json",
] as const;

const requiredValidationSteps = ["bun install --frozen-lockfile", "bun run validate"] as const;

export function validateBunVersionConsistency(
  packageManager: string | undefined,
  workflow: string,
): readonly string[] {
  const failures: string[] = [];
  const workflowMatch = /^\s*bun-version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(workflow);
  const workflowVersion = workflowMatch?.[1];

  if (workflowVersion === undefined) {
    failures.push("validate workflow must pin bun-version");
    return failures;
  }

  const expectedPackageManager = `bun@${workflowVersion}`;
  if (packageManager !== expectedPackageManager) {
    failures.push(
      `package.json packageManager must match validate workflow: expected ${expectedPackageManager}`,
    );
  }

  return failures;
}

export function validateRepository(): readonly string[] {
  const failures: string[] = [];

  for (const file of requiredFiles) {
    if (!existsSync(join(repositoryRoot, file))) {
      failures.push(`missing required repository file: ${file}`);
    }
  }

  const manifestPath = join(repositoryRoot, "package.json");
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        packageManager?: string;
        scripts?: Record<string, string>;
        workspaces?: string[];
      })
    : undefined;

  if (manifest !== undefined) {
    if (manifest.scripts?.validate === undefined) {
      failures.push("package.json must define the validate script");
    }
    if (
      manifest.workspaces?.includes("packages/*") !== true ||
      manifest.workspaces.includes("apps/*") !== true
    ) {
      failures.push("package.json must declare packages/* and apps/* workspaces");
    }
  }

  const workflowPath = join(repositoryRoot, ".github/workflows/validate.yml");
  if (existsSync(workflowPath)) {
    const workflow = readFileSync(workflowPath, "utf8");
    for (const step of requiredValidationSteps) {
      if (!workflow.includes(step)) {
        failures.push(`validate workflow must run: ${step}`);
      }
    }

    failures.push(...validateBunVersionConsistency(manifest?.packageManager, workflow));
  }

  if (!existsSync(workflowPath)) {
    failures.push(...validateBunVersionConsistency(manifest?.packageManager, ""));
  }

  return failures;
}

if (import.meta.main) {
  const failures = validateRepository();
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Repository baseline is valid.\n");
  }
}
