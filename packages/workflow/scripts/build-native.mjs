import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The adapter and native helper deliberately fail closed on non-Linux hosts.
if (process.platform === "linux") {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = join(root, "dist", "native");
  mkdirSync(output, { recursive: true });
  const result = spawnSync(
    "/usr/bin/cc",
    [
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      join(root, "native", "safe-source.c"),
      "-o",
      join(output, "safe-source-helper"),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
