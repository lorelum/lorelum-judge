import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSafeSource, type SafeSourceRoot, safeSourceRoot } from "../src/safe-source.js";

describe.skipIf(process.platform !== "linux")("openat2 source reader", () => {
  test("reads bytes and mode, rejects links and a replaced root", async () => {
    const base = await mkdtemp(join(tmpdir(), "safe-source-"));
    const root = join(base, "root");
    let identity: SafeSourceRoot | undefined;
    try {
      await mkdir(root);
      await writeFile(join(root, "file"), "allowed");
      await chmod(join(root, "file"), 0o640);
      await writeFile(join(base, "secret"), "secret");
      await symlink(join(base, "secret"), join(root, "symbolic"));
      await symlink(base, join(root, "ancestor"));
      await symlink(root, join(base, "root-link"));
      await link(join(base, "secret"), join(root, "hard"));
      identity = await safeSourceRoot(root);
      const file = await readSafeSource(root, "file", identity);
      expect(file?.data.toString()).toBe("allowed");
      expect(file?.mode).toBe(0o640);
      expect((await readSafeSource(root, "file", identity, undefined, 13))?.data.toString()).toBe(
        "allowed",
      );
      await expect(readSafeSource(root, "file", identity, undefined, 12)).rejects.toThrow(
        "output limit",
      );
      await expect(readSafeSource(root, "missing", identity, undefined, 1)).rejects.toThrow(
        "output limit",
      );
      await expect(readSafeSource(root, "file", identity, undefined, -1)).rejects.toThrow(
        "output limit",
      );
      expect(await readSafeSource(root, "missing", identity)).toBeNull();
      await expect(readSafeSource(root, "symbolic", identity)).rejects.toThrow();
      await expect(readSafeSource(root, "hard", identity)).rejects.toThrow();
      await expect(readSafeSource(root, "../secret", identity)).rejects.toThrow();
      await expect(readSafeSource(root, "ancestor/secret", identity)).rejects.toThrow();
      await expect(readSafeSource(root, ".git/config", identity)).rejects.toThrow();
      await expect(safeSourceRoot(join(base, "root-link"))).rejects.toThrow();
      await rename(root, join(base, "original"));
      await mkdir(root);
      await writeFile(join(root, "file"), "replacement");
      await expect(readSafeSource(root, "file", identity)).rejects.toThrow();
      await identity.close();
      await expect(readSafeSource(root, "file", identity)).rejects.toThrow();
    } finally {
      await identity?.close();
      await rm(base, { recursive: true, force: true });
    }
  });

  test("never reads through an ancestor repeatedly replaced by an outside symlink", async () => {
    const base = await mkdtemp(join(tmpdir(), "safe-source-race-"));
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "file"), "allowed");
    await writeFile(join(outside, "file"), "secret");
    const identity = await safeSourceRoot(root);
    const attacker = spawn(
      process.execPath,
      [
        "-e",
        `
      const fs = require('node:fs');
      const [root, outside] = process.argv.slice(1);
      const dir = root + '/dir', held = root + '/held';
      process.stdout.write('ready\\n');
      for (;;) {
        fs.renameSync(dir, held);
        fs.symlinkSync(outside, dir);
        fs.unlinkSync(dir);
        fs.renameSync(held, dir);
      }
    `,
        root,
        outside,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      await once(attacker.stdout!, "data");
      for (let i = 0; i < 100; i++) {
        let file: { data: Buffer; mode: number } | null;
        try {
          file = await readSafeSource(root, "dir/file", identity);
        } catch (error) {
          // Resolution races may fail closed (EAGAIN, ENOENT, or ELOOP).
          expect(error).toBeInstanceOf(Error);
          continue;
        }
        if (file) expect(file.data.toString()).toBe("allowed");
      }
    } finally {
      attacker.kill("SIGKILL");
      await once(attacker, "exit");
      await identity.close();
      await rm(base, { recursive: true, force: true });
    }
  });
});
