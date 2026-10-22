import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectGitSource } from "../src/sources/git.js";
import { collectLocalSource } from "../src/sources/local.js";

// Distinct index/working bytes are an attribution boundary, not interchangeable fixtures.
test("staged and unstaged snapshots retain raw bytes and detect a subsequently changed index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "judge-source-git-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.hooksPath=",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Source Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    );
  try {
    // Do not install machine-specific Git templates or hooks into the isolated fixture.
    git("init", "--quiet", "--template=");
    await writeFile(join(directory, "a.ts"), "base\r\n");
    git("add", "a.ts");
    git("commit", "--quiet", "-m", "base");
    await writeFile(join(directory, "a.ts"), "index\r\n");
    git("add", "a.ts");
    await writeFile(join(directory, "a.ts"), "working\r\n");
    const [staged, unstaged] = await Promise.all([
      collectGitSource({ kind: "git", path: directory, selection: "staged" }, {}),
      collectGitSource({ kind: "git", path: directory, selection: "unstaged" }, {}),
    ]);
    expect(staged.snapshot.issues).toEqual([]);
    expect(unstaged.snapshot.issues).toEqual([]);
    expect(staged.snapshot.items.map((item) => [item.side, item.text])).toEqual([
      ["old", "base\r\n"],
      ["new", "index\r\n"],
    ]);
    expect(unstaged.snapshot.items.map((item) => [item.side, item.text])).toEqual([
      ["old", "index\r\n"],
      ["new", "working\r\n"],
    ]);
    expect(staged.snapshot.items[1]?.contentIdentity).toBe(
      `sha256:${createHash("sha256").update("index\r\n").digest("hex")}`,
    );
    git("add", "a.ts");
    await staged.verify();
    expect(staged.snapshot.consistent).toBe(false);
    expect(staged.snapshot.issues.some((issue) => issue.code === "source_changed")).toBe(true);
    expect(staged.snapshot.items[1]?.text).toBe("index\r\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000); // Real Git processes take about ten seconds in the Windows Bun test host.

test("local context cannot escape its authorized root through traversal or a directory link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "judge-source-root-"));
  const root = join(directory, "allowed");
  const outside = join(directory, "outside");
  try {
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(root, "a.ts"), "allowed\n");
    await writeFile(join(outside, "private.ts"), "must not be disclosed\n");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const session = await collectLocalSource({ kind: "local", path: root }, {});
    await session.read({ kind: "read", path: "../outside/private.ts" });
    await session.read({ kind: "read", path: "linked/private.ts" });
    expect(session.snapshot.items.map((item) => item.text)).toEqual(["allowed\n"]);
    expect(session.snapshot.issues.some((issue) => issue.code === "outside_root")).toBe(true);
    expect(
      session.snapshot.issues.some(
        (issue) => issue.code === "local_unavailable" || issue.code === "symlink",
      ),
    ).toBe(true);
    await writeFile(join(root, "a.ts"), "changed\n");
    await session.verify();
    expect(session.snapshot.consistent).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
