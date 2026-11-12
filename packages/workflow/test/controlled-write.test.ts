import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAuthorizedFile } from "../src/controlled-write.js";

const initialIdentity = `sha256:${createHash("sha256").update("original").digest("hex")}`;

describe("atomic authorized writes", () => {
  test("revocation after staging leaves the target unchanged and removes temporary bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-write-"));
    const target = join(directory, "file.txt");
    try {
      await writeFile(target, "original");
      const controller = new AbortController();
      const guard = () => {
        const staged = readdirSync(directory).find((entry) => entry.startsWith(".lorelum-write-"));
        if (staged && statSync(join(directory, staged)).size > 0) controller.abort();
        controller.signal.throwIfAborted();
      };
      await expect(
        writeAuthorizedFile({
          target,
          expectedIdentity: initialIdentity,
          content: Buffer.from("updated"),
          guard,
          signal: controller.signal,
          resolveTarget: async () => target,
        }),
      ).rejects.toThrow();
      expect(await readFile(target, "utf8")).toBe("original");
      expect(await readdir(directory)).toEqual(["file.txt"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a target changed after staging is not overwritten", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-write-"));
    const target = join(directory, "file.txt");
    try {
      await writeFile(target, "original");
      let changed = false;
      const guard = () => {
        const staged = readdirSync(directory).find((entry) => entry.startsWith(".lorelum-write-"));
        if (!changed && staged && statSync(join(directory, staged)).size > 0) {
          changed = true;
          writeFileSync(target, "concurrent change");
        }
      };
      await expect(
        writeAuthorizedFile({
          target,
          expectedIdentity: initialIdentity,
          content: Buffer.from("updated"),
          guard,
          signal: new AbortController().signal,
          resolveTarget: async () => target,
        }),
      ).rejects.toThrow("precondition");
      expect(await readFile(target, "utf8")).toBe("concurrent change");
      expect(await readdir(directory)).toEqual(["file.txt"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
