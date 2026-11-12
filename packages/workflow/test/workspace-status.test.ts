import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeWorkspaceReview, discoverWorkspace } from "../src/workspace.js";

const linux = process.platform === "linux" ? describe : describe.skip;

linux("workspace Git index flags", () => {
  for (const flags of [
    ["--assume-unchanged"],
    ["--skip-worktree"],
    ["--assume-unchanged", "--skip-worktree"],
  ]) {
    test(`rejects ${flags.join(" and ")} without changing the index or working tree`, async () => {
      const root = await mkdtemp(join(tmpdir(), "workspace-status-"));
      try {
        const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
        git("init");
        git("config", "user.email", "test@example.invalid");
        git("config", "user.name", "Test");
        await writeFile(join(root, "tracked.txt"), "committed\n");
        git("add", "tracked.txt");
        git("commit", "-m", "initial");
        for (const flag of flags) git("update-index", flag, "tracked.txt");
        await writeFile(join(root, "tracked.txt"), "changed after flag\n");
        await writeFile(join(root, "untracked.txt"), "untracked\n");
        const index = await readFile(join(root, ".git", "index"));
        const tags = git("ls-files", "-v", "-z");
        const head = git("rev-parse", "HEAD");

        await expect(discoverWorkspace(root, [])).rejects.toThrow(
          "Git index contains assume-unchanged or skip-worktree entries",
        );

        expect(await readFile(join(root, ".git", "index"))).toEqual(index);
        expect(git("ls-files", "-v", "-z")).toEqual(tags);
        expect(git("rev-parse", "HEAD")).toEqual(head);
        expect(await readFile(join(root, "tracked.txt"), "utf8")).toBe("changed after flag\n");
        expect(await readFile(join(root, "untracked.txt"), "utf8")).toBe("untracked\n");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("continues to classify modified, untracked and ignored files without flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-status-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
      git("init");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Test");
      await writeFile(join(root, "tracked.txt"), "committed\n");
      await writeFile(join(root, ".gitignore"), "ignored.txt\n");
      git("add", "tracked.txt", ".gitignore");
      git("commit", "-m", "initial");
      await writeFile(join(root, "tracked.txt"), "changed\n");
      await writeFile(join(root, "untracked.txt"), "untracked\n");
      await writeFile(join(root, "ignored.txt"), "ignored\n");
      const index = await readFile(join(root, ".git", "index"));
      const review = await discoverWorkspace(root, []);
      try {
        expect(review.candidates.find((item) => item.path === "tracked.txt")?.origin).toBe(
          "modified",
        );
        expect(review.candidates.find((item) => item.path === "untracked.txt")?.origin).toBe(
          "untracked",
        );
        expect(review.candidates.find((item) => item.path === "ignored.txt")?.origin).toBe(
          "untracked",
        );
        expect(await readFile(join(root, ".git", "index"))).toEqual(index);
      } finally {
        await closeWorkspaceReview(review);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
