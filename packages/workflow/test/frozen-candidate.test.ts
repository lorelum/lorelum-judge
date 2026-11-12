import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectFailureDiff,
  freezeCandidate,
  renderCandidateDiff,
} from "../src/frozen-candidate.js";

const linux = process.platform === "linux" ? describe : describe.skip;
linux("candidate diff", () => {
  test("reports mode-only changes in frozen and stopped candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-mode-"));
    let runner: string | undefined;
    try {
      const path = join(root, "script.sh");
      await writeFile(path, "echo ok\n");
      await chmod(path, 0o755);
      const baseline = new Map([["script.sh", { data: Buffer.from("echo ok\n"), mode: 0o644 }]]);
      const frozen = await freezeCandidate(root, () => {});
      runner = frozen.root;
      const frozenDiff = await renderCandidateDiff(baseline, frozen);
      expect(frozenDiff).toContain("old mode 644");
      expect(frozenDiff).toContain("new mode 755");
      expect(await collectFailureDiff(root, baseline)).toBe(frozenDiff);
      await expect(collectFailureDiff(root, baseline, { bytes: 16 })).rejects.toThrow("limit");
      await expect(collectFailureDiff(root, baseline, { entries: 0 })).rejects.toThrow(
        "entry limit",
      );
      await expect(collectFailureDiff(root, baseline, { timeMs: 0 })).rejects.toThrow("time limit");
    } finally {
      if (runner) await rm(runner, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
