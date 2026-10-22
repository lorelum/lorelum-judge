import type { CodeSide, CodeSourceRole } from "@lorelum/judge-protocol";
import { byteIdentity, matchesPath, SourceCollector, sourceError, validRequest } from "./shared.js";
import type { DirectTarget, SourceOptions, SourceReadRequest, SourceSession } from "./types.js";

export async function collectDirectSource(
  target: DirectTarget,
  options: SourceOptions,
): Promise<SourceSession> {
  const collector = new SourceCollector(options);
  const materials: {
    path: string;
    text: string;
    side: CodeSide;
    role: CodeSourceRole;
    patch?: boolean;
    startLine?: number;
    version?: string;
  }[] = [];
  try {
    switch (target.kind) {
      case "snippet":
        materials.push({
          path: target.name ?? "snippet",
          text: target.text,
          side: "current",
          role: "target",
        });
        break;
      case "files":
        for (const file of target.files)
          materials.push({ ...file, side: "current", role: file.role ?? "target" });
        break;
      case "comparison": {
        const base = byteIdentity(Buffer.from(JSON.stringify(target.old)));
        const head = byteIdentity(Buffer.from(JSON.stringify(target.new)));
        for (const side of ["old", "new"] as const) {
          for (const file of target[side])
            materials.push({
              ...file,
              side,
              role: "target",
              version: side === "old" ? base : head,
            });
        }
        collector.snapshot.comparisons.push({
          source: "provided",
          kind: "comparison",
          base,
          head,
          addedPaths: target.new
            .filter((file) => !target.old.some((old) => old.path === file.path))
            .map((file) => file.path),
          deletedPaths: target.old
            .filter((file) => !target.new.some((next) => next.path === file.path))
            .map((file) => file.path),
        });
        break;
      }
      case "diff": {
        if (typeof target.text !== "string") throw new Error("Patch text must be a string");
        const patchIdentity = byteIdentity(Buffer.from(target.text));
        materials.push({
          path: target.name ?? "provided.diff",
          text: target.text,
          side: "current",
          role: "target",
          patch: true,
        });
        collector.issue(
          "patch_only",
          "Patch old/new locations are declared by the supplied patch; complete files and base/head revisions are unavailable",
        );
        collector.snapshot.comparisons.push({
          source: target.name ?? "provided.diff",
          kind: "patch",
          base: `${patchIdentity}:old`,
          head: `${patchIdentity}:new`,
        });
        const lines = target.text.split("\n");
        let oldPath = "";
        let newPath = "";
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index] ?? "";
          if (line.startsWith("--- "))
            oldPath = line.slice(4).split("\t")[0]?.replace(/^a\//, "") ?? "";
          else if (line.startsWith("+++ "))
            newPath = line.slice(4).split("\t")[0]?.replace(/^b\//, "") ?? "";
          else if (line.startsWith("@@ ")) {
            const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
            if (!header || !oldPath || !newPath) {
              collector.issue(
                "patch_location_unavailable",
                "Patch hunk has no supported file header or coordinates",
              );
              continue;
            }
            const oldCount = Number(header[2] ?? 1);
            const newCount = Number(header[4] ?? 1);
            const oldLines: string[] = [];
            const newLines: string[] = [];
            let oldTerminated = true;
            let newTerminated = true;
            let previous = "";
            let cursor = index + 1;
            while (cursor < lines.length) {
              const body = lines[cursor] ?? "";
              if (body.startsWith("\\ No newline at end of file")) {
                if (previous === "-" || previous === " ") oldTerminated = false;
                if (previous === "+" || previous === " ") newTerminated = false;
                cursor++;
                continue;
              }
              if (oldLines.length >= oldCount && newLines.length >= newCount) break;
              previous = body[0] ?? "";
              if (previous === " ") {
                oldLines.push(body.slice(1));
                newLines.push(body.slice(1));
              } else if (previous === "-") oldLines.push(body.slice(1));
              else if (previous === "+") newLines.push(body.slice(1));
              else break;
              cursor++;
            }
            index = cursor - 1;
            if (
              oldLines.length !== oldCount ||
              newLines.length !== newCount ||
              (oldCount > 0 && Number(header[1]) < 1) ||
              (newCount > 0 && Number(header[3]) < 1)
            ) {
              collector.issue(
                "invalid_patch_hunk",
                "Patch hunk body does not match its declared coordinates",
              );
              continue;
            }
            if (oldCount && oldPath !== "/dev/null")
              materials.push({
                path: oldPath,
                text: oldLines.join("\n") + (oldTerminated ? "\n" : ""),
                side: "old",
                role: "target",
                patch: true,
                startLine: Number(header[1]),
                version: `${patchIdentity}:old`,
              });
            if (newCount && newPath !== "/dev/null")
              materials.push({
                path: newPath,
                text: newLines.join("\n") + (newTerminated ? "\n" : ""),
                side: "new",
                role: "target",
                patch: true,
                startLine: Number(header[3]),
                version: `${patchIdentity}:new`,
              });
            const comparison = collector.snapshot.comparisons[0];
            if (comparison && oldPath === "/dev/null" && oldCount === 0 && newCount > 0) {
              comparison.addedPaths ??= [];
              if (!comparison.addedPaths.includes(newPath)) comparison.addedPaths.push(newPath);
            }
            if (comparison && newPath === "/dev/null" && newCount === 0 && oldCount > 0) {
              comparison.deletedPaths ??= [];
              if (!comparison.deletedPaths.includes(oldPath)) comparison.deletedPaths.push(oldPath);
            }
          }
        }
        break;
      }
    }
    for (const material of materials) {
      if (
        typeof material.path !== "string" ||
        typeof material.text !== "string" ||
        !["target", "context", "requirement", "opinion"].includes(material.role)
      )
        throw new Error("Invalid direct source material");
    }
  } catch (error) {
    collector.issue("invalid_target", sourceError(error), undefined, true);
    materials.length = 0;
  }
  const read = async (request: SourceReadRequest): Promise<void> => {
    if (!validRequest(collector, request)) return;
    let found = false;
    for (const material of materials) {
      if (
        !matchesPath(material.path, request.path) ||
        (request.side && request.side !== material.side)
      )
        continue;
      found = true;
      if (!collector.discover(material.path)) break;
      if (request.kind === "list") continue;
      if (request.kind === "search" && !material.text.includes(request.query ?? "")) continue;
      const bytes = Buffer.from(material.text);
      collector.add({
        path: material.path,
        bytes,
        side: material.side,
        role: material.role,
        version: material.version ?? byteIdentity(bytes),
        provenance: material.patch ? "patch" : "provided",
        complete: !material.patch,
        ...(material.startLine ? { startLine: material.startLine } : {}),
        request: { ...request, startLine: request.startLine ?? material.startLine ?? 1 },
      });
    }
    if (!found)
      collector.issue(
        "source_unavailable",
        "No supplied material matches the request",
        request.path,
      );
  };
  if (collector.request()) {
    for (const material of materials) {
      if (!collector.discover(material.path)) break;
      const bytes = Buffer.from(material.text);
      collector.add({
        path: material.path,
        bytes,
        side: material.side,
        role: material.role,
        version: material.version ?? byteIdentity(bytes),
        provenance: material.patch ? "patch" : "provided",
        complete: !material.patch,
        ...(material.startLine ? { startLine: material.startLine } : {}),
      });
    }
  }
  return {
    snapshot: collector.snapshot,
    read,
    async verify() {
      collector.cancelled();
    },
  };
}
