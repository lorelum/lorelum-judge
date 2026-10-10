import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compile } from "json-schema-to-typescript";

type Schema = Parameters<typeof compile>[0];

const repositoryRoot = join(import.meta.dir, "..");
const schemaDirectory = join(repositoryRoot, "packages/protocol/src/schemas");
const outputDirectory = join(repositoryRoot, "packages/protocol/src/generated");

const banner =
  "// Generated from src/schemas by scripts/generate-protocol-types.ts. Do not edit.\n";

async function generate(): Promise<ReadonlyMap<string, string>> {
  const outputs = new Map<string, string>();
  const files = readdirSync(schemaDirectory)
    .filter((name) => name.endsWith(".schema.json"))
    .sort();

  for (const file of files) {
    const parsed: unknown = JSON.parse(readFileSync(join(schemaDirectory, file), "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("title" in parsed) ||
      typeof parsed.title !== "string"
    ) {
      throw new Error(`${file} must be an object with a string title`);
    }
    const title = parsed.title;
    const schema = parsed as Schema;
    const body = await compile(schema, title, {
      bannerComment: banner,
      additionalProperties: false,
      format: false,
    });
    outputs.set(`${file.replace(/\.schema\.json$/, "")}.ts`, body);
  }
  return outputs;
}

const outputs = await generate();

function orphans(): string[] {
  if (!existsSync(outputDirectory)) {
    return [];
  }
  return readdirSync(outputDirectory).filter((name) => !outputs.has(name));
}

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const [name, body] of outputs) {
    const path = join(outputDirectory, name);
    if (!existsSync(path) || readFileSync(path, "utf8") !== body) {
      stale.push(name);
    }
  }
  const extra = orphans();
  if (stale.length > 0 || extra.length > 0) {
    const parts = [
      ...(stale.length > 0 ? [`stale: ${stale.join(", ")}`] : []),
      ...(extra.length > 0 ? [`orphaned: ${extra.join(", ")}`] : []),
    ];
    process.stderr.write(
      `Generated protocol types are out of date (${parts.join("; ")}). Run bun run generate:protocol.\n`,
    );
    process.exit(1);
  }
  process.stdout.write("Generated protocol types are up to date.\n");
} else {
  mkdirSync(outputDirectory, { recursive: true });
  for (const name of orphans()) {
    rmSync(join(outputDirectory, name));
  }
  for (const [name, body] of outputs) {
    writeFileSync(join(outputDirectory, name), body);
  }
  process.stdout.write(`Generated ${outputs.size} protocol type files.\n`);
}
