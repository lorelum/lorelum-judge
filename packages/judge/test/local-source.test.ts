import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectDirectSource } from "../src/sources/direct.js";
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
      collectGitSource(
        { kind: "git", path: directory, selection: "unstaged" },
        { limits: { maxBytes: 17 } },
      ),
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
    await unstaged.verify();
    await unstaged.verify();
    expect(unstaged.snapshot.consistent).toBe(true);
    expect(unstaged.snapshot.issues).toEqual([]);
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

test("repeated bounded verification does not invent changes and still detects real edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "judge-repeat-verify-"));
  const path = join(root, "a.ts");
  try {
    await writeFile(path, "a".repeat(700));
    const session = await collectLocalSource(
      { kind: "local", path },
      { roots: [root], limits: { maxBytes: 1024 } },
    );
    await session.verify();
    await session.verify();
    expect(session.snapshot.consistent).toBe(true);
    expect(session.snapshot.issues).toEqual([]);
    await writeFile(path, "b".repeat(700));
    await session.verify();
    expect(session.snapshot.consistent).toBe(false);
    expect(session.snapshot.issues.some((issue) => issue.code === "source_changed")).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a verification budget refusal is uncertainty rather than an observed change", async () => {
  const root = await mkdtemp(join(tmpdir(), "judge-verify-unavailable-"));
  const path = join(root, "a.ts");
  try {
    await writeFile(path, "a".repeat(700));
    const session = await collectLocalSource(
      { kind: "local", path },
      { roots: [root], limits: { maxBytes: 1024 } },
    );
    await writeFile(path, "b".repeat(1200));
    await session.verify();
    expect(session.snapshot.consistent).toBe(true);
    expect(session.snapshot.issues.some((issue) => issue.code === "verification_unavailable")).toBe(
      true,
    );
    expect(session.snapshot.issues.some((issue) => issue.code === "source_changed")).toBe(false);
    expect(session.snapshot.items[0]?.text).toBe("a".repeat(700));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local and supplied sources agree on mixed separators, slices and raw identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "judge-source-lines-"));
  const path = join(root, "a.ts");
  try {
    for (const text of ["first\rsecond\r\nthird\n", "first\nsecond\nthird", "", "\r"]) {
      await writeFile(path, text);
      const sessions = [
        await collectLocalSource({ kind: "local", path }, { roots: [root] }),
        await collectDirectSource({ kind: "files", files: [{ path: "a.ts", text }] }, {}),
      ];
      const endLine = text === "" ? 0 : text === "\r" ? 1 : 3;
      for (const session of sessions) {
        expect(session.snapshot.issues).toEqual([]);
        const original = session.snapshot.items[0];
        expect(original).toMatchObject({ text, startLine: 1, endLine, complete: true });
        expect(original?.contentIdentity).toBe(
          `sha256:${createHash("sha256").update(text).digest("hex")}`,
        );
        await session.read({ kind: "list", path: "a.ts", startLine: 0 });
        expect(session.snapshot.issues.some((issue) => issue.code === "invalid_request")).toBe(
          true,
        );
        if (endLine !== 3) continue;
        await session.read({ kind: "read", path: "a.ts", startLine: 1, endLine: 3 });
        expect(session.snapshot.items).toHaveLength(1);
        expect(session.snapshot.items[0]?.id).toBe(original?.id);
        await session.read({
          kind: "search",
          path: "a.ts",
          query: "second",
          startLine: 2,
          endLine: 2,
        });
        expect(session.snapshot.items.at(-1)).toMatchObject({
          text: "second",
          startLine: 2,
          endLine: 2,
          complete: false,
          contentIdentity: original?.contentIdentity,
        });
        await session.read({ kind: "read", path: "a.ts", startLine: 4 });
        expect(session.snapshot.issues.some((issue) => issue.code === "range_unavailable")).toBe(
          true,
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pinned Git context uses the same range, identity and deduplication rules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "judge-source-git-range-"));
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
    git("init", "--quiet", "--template=");
    const text = "first\rsecond\r\nthird\n";
    await writeFile(join(directory, "a.ts"), text);
    git("add", "a.ts");
    git("commit", "--quiet", "-m", "base");
    const session = await collectLocalSource({ kind: "local", path: directory, ref: "HEAD" }, {});
    const original = session.snapshot.items[0];
    expect(session.snapshot.issues).toEqual([]);
    expect(original).toMatchObject({ text, startLine: 1, endLine: 3, complete: true });
    await session.read({ kind: "read", path: "a.ts", startLine: 1, endLine: 3 });
    expect(session.snapshot.items).toHaveLength(1);
    await session.read({
      kind: "search",
      path: "a.ts",
      query: "second",
      startLine: 2,
      endLine: 2,
    });
    expect(session.snapshot.items.at(-1)).toMatchObject({
      text: "second",
      startLine: 2,
      endLine: 2,
      complete: false,
      version: original?.version,
      contentIdentity: original?.contentIdentity,
    });
    await session.read({ kind: "list", path: "a.ts", startLine: 0 });
    expect(session.snapshot.issues.some((issue) => issue.code === "invalid_request")).toBe(true);
    await session.verify();
    expect(session.snapshot.consistent).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
