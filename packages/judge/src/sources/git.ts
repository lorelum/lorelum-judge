import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CodeSide, CodeTarget } from "@lorelum/judge-protocol";
import { isWithinRoot, readLocalBytes } from "./local.js";
import { byteIdentity, matchesPath, SourceCollector, sourceError, validRequest } from "./shared.js";
import type { SourceOptions, SourceReadRequest, SourceSession } from "./types.js";

type Entry = { oid: string; mode: string; bytes?: Buffer; working?: boolean };
type GitTarget = Extract<CodeTarget, { kind: "git" }>;

export async function collectGitSource(
  target: GitTarget,
  options: SourceOptions,
  fullTree = false,
): Promise<SourceSession> {
  const collector = new SourceCollector(options);
  let cwd = "";
  let executable = "";
  let root = "";
  let roots: string[] = [];
  let base = "";
  let head = "";
  let initialPrefix = "";
  let indexIdentity: string | undefined;
  let headIdentity: string | undefined;
  let untrackedIdentity: string | undefined;
  let objectFormat = "sha1";
  const untrackedPaths = new Set<string>();
  const observedModes = new Map<string, number>();
  const observed = new Map<string, string>();
  const unavailableWorking = new Set<string>();
  const oldEntries = new Map<string, Entry>();
  const newEntries = new Map<string, Entry>();
  const versions: Partial<Record<CodeSide, string>> = {};
  const command = async (args: string[]): Promise<Buffer> => {
    if (!collector.request()) throw new Error("Git request budget exhausted or cancelled");
    const { promise, resolve: resolveOutput, reject } = Promise.withResolvers<Buffer>();
    const environment = { ...process.env };
    for (const key of Object.keys(environment))
      if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
    execFile(
      executable,
      [
        "--no-optional-locks",
        "--no-replace-objects",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ],
      {
        cwd,
        encoding: "buffer",
        maxBuffer: Math.max(collector.limits.maxBytes, collector.limits.maxEntries * 256),
        signal: options.signal,
        timeout: 30000,
        windowsHide: true,
        env: {
          ...environment,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_LITERAL_PATHSPECS: "1",
          GIT_EXTERNAL_DIFF: "",
          GIT_PAGER: "cat",
        },
      },
      (error, stdout) => {
        // Do not copy stderr/configured remote URLs or credentials into persistent issues.
        if (error)
          reject(new Error(`Read-only Git command ${args[0]} failed (${error.code ?? "unknown"})`));
        else resolveOutput(stdout);
      },
    );
    return promise;
  };
  const resolveCommit = async (ref: string): Promise<string> => {
    if (typeof ref !== "string" || !ref || ref.startsWith("-") || ref.includes("\0"))
      throw new Error("Invalid Git revision");
    const oid = (await command(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]))
      .toString("utf8")
      .trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))
      throw new Error("Git did not resolve a commit object");
    return oid;
  };
  const parseEntries = (bytes: Buffer, index: boolean): Map<string, Entry> => {
    const result = new Map<string, Entry>();
    for (const record of bytes.toString("utf8").split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      const metadata = record.slice(0, tab).split(" ");
      const path = record.slice(tab + 1);
      if (
        tab < 0 ||
        !path ||
        path.includes("\ufffd") ||
        isAbsolute(path) ||
        path.split("/").some((part) => part === ".." || part.toLowerCase() === ".git")
      )
        throw new Error("Invalid or unsupported Git path encoding");
      if (!roots.some((authorized) => isWithinRoot(resolve(root, path), authorized))) continue;
      if (!collector.discover(path)) break;
      if (index && metadata[2] !== "0") {
        collector.issue(
          "index_conflict",
          "Unmerged index entry prevents a meaningful snapshot",
          path,
          true,
        );
        continue;
      }
      const mode = metadata[0] ?? "";
      const oid = metadata[index ? 1 : 2] ?? "";
      result.set(path, { mode, oid });
    }
    return result;
  };
  const tree = async (oid: string): Promise<Map<string, Entry>> => {
    if (oid === "empty-tree") return new Map();
    return parseEntries(await command(["ls-tree", "-rz", "--full-tree", oid]), false);
  };
  const copy = (source: Map<string, Entry>, destination: Map<string, Entry>): void => {
    for (const [path, entry] of source) destination.set(path, entry);
  };
  const selected = (path: string): boolean =>
    target.paths
      ? target.paths.some((prefix) => matchesPath(path, prefix))
      : !fullTree || matchesPath(path, initialPrefix);
  const workingEntry = async (path: string, previous?: Entry): Promise<Entry | undefined> => {
    const absolute = resolve(root, path);
    try {
      const info = await lstat(absolute);
      if (!info.isFile())
        throw new Error(
          "Working entry is not a regular file; links and special files are not followed",
        );
      observedModes.set(path, info.mode);
      const data = await readLocalBytes(absolute, roots, collector);
      if (!data) return;
      const format =
        (previous?.oid.length ?? (objectFormat === "sha256" ? 64 : 40)) === 64 ? "sha256" : "sha1";
      const oid = createHash(format)
        .update(`blob ${data.bytes.byteLength}\0`)
        .update(data.bytes)
        .digest("hex");
      observed.set(path, byteIdentity(data.bytes));
      const mode =
        process.platform === "win32"
          ? (previous?.mode ?? "100644")
          : info.mode & 0o111
            ? "100755"
            : "100644";
      return { oid, mode, bytes: data.bytes, working: true };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        observed.set(path, "absent");
        return;
      }
      collector.omit(path, "working_unavailable", sourceError(error));
      unavailableWorking.add(path);
      return;
    }
  };
  const emit = async (
    path: string,
    entry: Entry,
    side: CodeSide,
    request?: SourceReadRequest,
  ): Promise<void> => {
    if (collector.cancelled()) return;
    if (collector.snapshot.items.length >= collector.limits.maxFiles) {
      collector.omit(path, "file_limit", "Source item limit reached");
      return;
    }
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      collector.omit(
        path,
        "unsupported_git_entry",
        "Symlink, submodule or non-regular Git entry is not read",
      );
      return;
    }
    try {
      let bytes = entry.bytes;
      if (!bytes && entry.working) {
        const current = await workingEntry(path, entry);
        if (!current?.bytes) return;
        newEntries.set(path, current);
        entry = current;
        bytes = current.bytes;
      }
      if (!bytes) {
        const size = Number((await command(["cat-file", "-s", entry.oid])).toString("utf8").trim());
        if (!Number.isSafeInteger(size) || size > collector.limits.maxFileBytes) {
          collector.omit(path, "file_limit", "Git blob exceeds raw byte limit");
          return;
        }
        if (!collector.reserveBytes(size, path)) return;
        bytes = await command(["cat-file", "blob", entry.oid]);
      }
      if (request?.kind === "search" && !bytes.toString("utf8").includes(request.query ?? ""))
        return;
      collector.add({
        path,
        bytes,
        side,
        version: versions[side] ?? head,
        provenance: "git",
        role: request ? "context" : "target",
        ...(request ? { request } : {}),
      });
    } catch (error) {
      collector.omit(path, "git_blob_unavailable", sourceError(error));
    }
  };
  const read = async (request: SourceReadRequest): Promise<void> => {
    if (!validRequest(collector, request)) return;
    if (isAbsolute(request.path) || request.path.split(/[\\/]/).includes("..")) {
      collector.issue("outside_root", "Git reads require repository-relative paths", request.path);
      return;
    }
    const side = request.side ?? (fullTree ? "current" : "new");
    if (side === "current" && !fullTree) {
      collector.issue(
        "side_unavailable",
        "Comparison context must select old or new",
        request.path,
      );
      return;
    }
    const entries = side === "old" ? oldEntries : newEntries;
    let found = false;
    for (const [path, entry] of entries) {
      if (!matchesPath(path, request.path)) continue;
      found = true;
      if (request.kind !== "list") await emit(path, entry, side, request);
      if (collector.cancelled()) break;
    }
    if (!found)
      collector.issue(
        "source_unavailable",
        "Path does not exist in the fixed Git snapshot",
        request.path,
      );
  };
  try {
    if (!collector.cancelled()) {
      if (
        !["staged", "unstaged", "untracked", "commit", "compare", "branch", "working"].includes(
          target.selection,
        )
      )
        throw new Error("Invalid Git selection");
      if (
        target.paths?.some(
          (path) =>
            typeof path !== "string" ||
            isAbsolute(path) ||
            path.includes("\0") ||
            path.split(/[\\/]/).includes(".."),
        )
      )
        throw new Error("Invalid repository-relative path selection");
      const targetPath = await realpath(target.path);
      const targetInfo = await stat(targetPath);
      if (!targetInfo.isDirectory() && !fullTree)
        throw new Error("Git source path must be a directory");
      cwd = targetInfo.isDirectory() ? targetPath : dirname(targetPath);
      roots = options.roots
        ? await Promise.all(options.roots.map((path) => realpath(path)))
        : [targetPath];
      if (!roots.some((authorized) => isWithinRoot(targetPath, authorized)))
        throw new Error("Git target is outside authorized roots");
      // Resolve from absolute host PATH entries, never Windows' implicit candidate-CWD search.
      for (const directory of (process.env.PATH ?? process.env.Path ?? "").split(delimiter)) {
        if (!isAbsolute(directory)) continue;
        const binary = resolve(directory, process.platform === "win32" ? "git.exe" : "git");
        if (isWithinRoot(binary, cwd)) continue;
        try {
          await access(binary, constants.X_OK);
          const actualBinary = await realpath(binary);
          if (isWithinRoot(actualBinary, cwd)) continue;
          executable = actualBinary;
          break;
        } catch {
          // A PATH entry without an executable Git is not the selected client.
        }
      }
      if (!executable) throw new Error("No trusted Git executable was found in the host PATH");
      root = (await command(["rev-parse", "--show-toplevel"])).toString("utf8").trim();
      root = await realpath(root);
      initialPrefix = relative(root, targetPath).split(sep).join("/");
      cwd = root;
      objectFormat = (await command(["rev-parse", "--show-object-format"])).toString("utf8").trim();
      if (objectFormat !== "sha1" && objectFormat !== "sha256")
        throw new Error("Unsupported Git object format");
      if (
        target.selection === "commit" ||
        target.selection === "compare" ||
        target.selection === "branch"
      ) {
        head = await resolveCommit(target.head ?? "HEAD");
        if (fullTree) {
          copy(await tree(head), newEntries);
          versions.current = head;
        } else {
          if (target.selection === "commit") {
            const commit = (await command(["cat-file", "commit", head])).toString("utf8");
            const parents =
              commit
                .split("\n\n", 1)[0]
                ?.split("\n")
                .filter((line) => line.startsWith("parent "))
                .map((line) => line.slice(7)) ?? [];
            const parent = target.parent ?? 1;
            if (
              !Number.isSafeInteger(parent) ||
              parent < 1 ||
              (parents.length > 0 && parent > parents.length) ||
              (parents.length === 0 && parent !== 1)
            )
              throw new Error("Invalid commit parent selection");
            base = parents[parent - 1] ?? "empty-tree";
          } else {
            if (!target.base)
              throw new Error("Compare and branch selections require an explicit base");
            base = await resolveCommit(target.base);
          }
          let comparisonBase = base;
          if (target.selection === "branch") {
            const bases = (await command(["merge-base", "--all", base, head]))
              .toString("utf8")
              .trim()
              .split("\n");
            if (bases.length !== 1 || !/^[a-f0-9]{40,64}$/.test(bases[0] ?? ""))
              throw new Error("Branch comparison does not have one unambiguous merge base");
            comparisonBase = bases[0] ?? "";
          }
          copy(await tree(comparisonBase), oldEntries);
          copy(await tree(head), newEntries);
          versions.old = comparisonBase;
          versions.new = head;
          collector.snapshot.comparisons.push({
            source: root,
            kind:
              target.selection === "commit"
                ? `commit:parent:${target.parent ?? 1}`
                : target.selection,
            base,
            head,
            ...(target.selection === "branch" ? { mergeBase: comparisonBase } : {}),
          });
        }
      } else {
        const rawIndex = await command(["ls-files", "--stage", "-z"]);
        indexIdentity = byteIdentity(rawIndex);
        const index = parseEntries(rawIndex, true);
        if (collector.snapshot.issues.some((issue) => issue.code === "index_conflict"))
          throw new Error("Conflicted index is not a reviewable baseline");
        headIdentity = "empty-tree";
        if (target.selection === "staged" || target.selection === "working") {
          try {
            headIdentity = await resolveCommit("HEAD");
          } catch (error) {
            // An unborn repository is distinct from an unavailable HEAD object.
            const ref = (await command(["symbolic-ref", "-q", "HEAD"])).toString("utf8").trim();
            const refs = (await command(["for-each-ref", "--format=%(refname)", ref]))
              .toString("utf8")
              .trim();
            if (refs) throw error;
          }
        }
        if (target.selection === "staged") {
          copy(await tree(headIdentity), oldEntries);
          copy(index, newEntries);
          base = headIdentity;
          head = `index:${indexIdentity}`;
        } else if (target.selection === "untracked") {
          base = "empty-tree";
          head = "working:untracked";
          for (const [path, entry] of index) newEntries.set(path, { ...entry, working: true });
        } else {
          copy(target.selection === "working" ? await tree(headIdentity) : index, oldEntries);
          base = target.selection === "working" ? headIdentity : `index:${indexIdentity}`;
          head = "working";
          for (const [path, entry] of index) newEntries.set(path, { ...entry, working: true });
          let scannedBytes = 0;
          for (const [path, entry] of index) {
            if (!selected(path)) continue;
            if (scannedBytes >= collector.limits.maxBytes) {
              collector.omit(path, "byte_limit", "Working tree scanning byte budget exhausted");
              unavailableWorking.add(path);
              continue;
            }
            if (entry.mode !== "100644" && entry.mode !== "100755") {
              collector.omit(
                path,
                "unsupported_git_entry",
                "Non-regular index entry is not followed",
              );
              unavailableWorking.add(path);
              continue;
            }
            const working = await workingEntry(path, entry);
            if (working) {
              scannedBytes += working.bytes?.byteLength ?? 0;
              newEntries.set(path, working);
            } else if (observed.get(path) === "absent") {
              newEntries.delete(path);
            } else {
              unavailableWorking.add(path);
            }
          }
        }
        if (
          target.selection === "untracked" ||
          (target.selection === "working" && target.paths !== undefined)
        ) {
          const untracked = await command(["ls-files", "--others", "--exclude-standard", "-z"]);
          untrackedIdentity = byteIdentity(untracked);
          let scannedBytes = 0;
          for (const path of untracked.toString("utf8").split("\0")) {
            if (!path || !selected(path)) continue;
            if (!roots.some((authorized) => isWithinRoot(resolve(root, path), authorized)))
              continue;
            untrackedPaths.add(path);
            if (!collector.discover(path)) break;
            if (scannedBytes >= collector.limits.maxBytes) {
              collector.omit(path, "byte_limit", "Untracked scanning byte budget exhausted");
              continue;
            }
            const entry = await workingEntry(path);
            if (entry) {
              scannedBytes += entry.bytes?.byteLength ?? 0;
              newEntries.set(path, entry);
            }
          }
        }
        if (head.startsWith("working"))
          head = `working:${byteIdentity(Buffer.from(JSON.stringify([...newEntries].map(([path, entry]) => [path, entry.oid, entry.mode]))))}`;
        versions.old = base;
        versions.new = head;
        collector.snapshot.comparisons.push({ source: root, kind: target.selection, base, head });
      }
      const comparison = collector.snapshot.comparisons.at(-1);
      if (comparison && !collector.snapshot.issues.some((issue) => issue.code === "entry_limit")) {
        comparison.addedPaths = [...newEntries.keys()].filter(
          (path) =>
            selected(path) &&
            !oldEntries.has(path) &&
            !unavailableWorking.has(path) &&
            (target.selection !== "untracked" || untrackedPaths.has(path)),
        );
        comparison.deletedPaths = [...oldEntries.keys()].filter(
          (path) => selected(path) && !newEntries.has(path) && !unavailableWorking.has(path),
        );
      }
      const paths = new Set([...oldEntries.keys(), ...newEntries.keys()]);
      for (const path of paths) {
        if (!selected(path)) continue;
        if (target.selection === "untracked" && !untrackedPaths.has(path)) continue;
        if (unavailableWorking.has(path)) continue;
        const old = oldEntries.get(path);
        const next = newEntries.get(path);
        if (!fullTree && old?.oid === next?.oid && old?.mode === next?.mode) continue;
        if (old) await emit(path, old, "old");
        if (next) await emit(path, next, fullTree ? "current" : "new");
        if (collector.cancelled()) break;
      }
    }
  } catch (error) {
    collector.issue("git_unavailable", sourceError(error), target.path, true);
  }
  return {
    snapshot: collector.snapshot,
    read,
    async verify() {
      if (collector.cancelled() || !root) return;
      try {
        if (
          indexIdentity !== undefined &&
          byteIdentity(await command(["ls-files", "--stage", "-z"])) !== indexIdentity
        )
          throw new Error("Index changed after snapshot collection");
        if (
          headIdentity !== undefined &&
          (target.selection === "staged" || target.selection === "working")
        ) {
          let current = "empty-tree";
          try {
            current = await resolveCommit("HEAD");
          } catch {
            if (headIdentity !== "empty-tree") throw new Error("HEAD became unavailable");
          }
          if (current !== headIdentity) throw new Error("HEAD changed after snapshot collection");
        }
        if (
          untrackedIdentity !== undefined &&
          byteIdentity(await command(["ls-files", "--others", "--exclude-standard", "-z"])) !==
            untrackedIdentity
        )
          throw new Error("Untracked file enumeration changed after snapshot collection");
        for (const [path, identity] of observed) {
          if (identity === "absent") {
            try {
              await stat(resolve(root, path));
            } catch (error) {
              if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "ENOENT"
              )
                continue;
              throw error;
            }
            throw new Error(`Previously absent working file appeared: ${path}`);
          }
          const data = await readLocalBytes(resolve(root, path), roots, collector, true);
          if (!data || byteIdentity(data.bytes) !== identity)
            throw new Error(`Working bytes changed: ${path}`);
          const mode = observedModes.get(path);
          if (mode !== undefined && (await lstat(resolve(root, path))).mode !== mode)
            throw new Error(`Working file mode changed: ${path}`);
        }
      } catch (error) {
        collector.snapshot.consistent = false;
        collector.issue("source_changed", sourceError(error), root);
      }
    },
  };
}
