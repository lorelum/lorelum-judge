import type { CodeTarget } from "@lorelum/judge-protocol";
import { collectDirectSource } from "./direct.js";
import { collectGitSource } from "./git.js";
import { collectGithubSource } from "./github.js";
import { collectLocalSource } from "./local.js";
import { SourceCollector, sourceError } from "./shared.js";
import type { SourceOptions, SourceSession } from "./types.js";

export type { SourceLimits, SourceOptions, SourceReadRequest, SourceSession } from "./types.js";

export async function collectCodeSources(
  target: CodeTarget,
  options: SourceOptions = {},
): Promise<SourceSession> {
  try {
    if (!target || typeof target !== "object") throw new Error("A code source target is required");
    switch (target.kind) {
      case "snippet":
      case "files":
      case "comparison":
      case "diff":
        return await collectDirectSource(target, options);
      case "local":
        return await collectLocalSource(target, options);
      case "git":
        return await collectGitSource(target, options);
      case "github":
        return await collectGithubSource(target, options);
      default:
        throw new Error("Unsupported code source kind");
    }
  } catch (error) {
    const collector = new SourceCollector(options);
    if (!collector.cancelled())
      collector.issue("source_unavailable", sourceError(error), undefined, true);
    return {
      snapshot: collector.snapshot,
      async read() {
        collector.issue("source_unavailable", "Initial source collection failed", undefined, true);
      },
      async verify() {
        collector.cancelled();
      },
    };
  }
}
