import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type {
  CodeSide,
  CodeSourceItem,
  CodeSourceRole,
  SourceSnapshot,
} from "@lorelum/judge-protocol";
import { codeSourceLines } from "@lorelum/judge-protocol";
import type { SourceLimits, SourceOptions, SourceReadRequest } from "./types.js";

export const DEFAULT_SOURCE_LIMITS: Readonly<SourceLimits> = {
  maxFiles: 64,
  maxBytes: 4 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxEntries: 20000,
  maxRequests: 128,
};

export function byteIdentity(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sourceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SourceChangedError extends Error {}

export function recordVerificationFailure(
  collector: SourceCollector,
  error: unknown,
  path: string,
): void {
  const changed =
    error instanceof SourceChangedError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR") &&
      "syscall" in error &&
      (error.syscall === "open" ||
        error.syscall === "realpath" ||
        error.syscall === "stat" ||
        error.syscall === "lstat"));
  if (changed) collector.snapshot.consistent = false;
  collector.issue(
    changed ? "source_changed" : "verification_unavailable",
    sourceError(error),
    path,
  );
}

/** A session-local budget. Raw byte identity is never computed from decoded text. */
export class SourceCollector {
  readonly snapshot: SourceSnapshot = {
    schema: "lorelum.judge.source-snapshot/v1",
    items: [],
    issues: [],
    discovered: [],
    omitted: [],
    comparisons: [],
    consistent: true,
  };
  readonly limits: SourceLimits;
  private bytes = 0;
  private entries = 0;
  private acquiredBytes = 0;
  private verifiedBytes = 0;
  private requests = 0;
  private readonly namespace = randomUUID();
  private readonly seen = new Set<string>();
  private readonly emitted = new Set<string>();

  constructor(readonly options: SourceOptions) {
    this.limits = { ...DEFAULT_SOURCE_LIMITS };
    for (const key of Object.keys(this.limits) as (keyof SourceLimits)[]) {
      const value = options.limits?.[key];
      if (value !== undefined) {
        if (Number.isSafeInteger(value) && value > 0) this.limits[key] = value;
        else this.issue("invalid_limit", `Invalid source limit: ${key}`, undefined, true);
      }
    }
  }

  issue(code: string, message: string, source?: string, fatal = false): void {
    this.snapshot.issues.push({
      code,
      message,
      ...(source === undefined ? {} : { source }),
      ...(fatal ? { fatal } : {}),
    });
  }

  cancelled(): boolean {
    if (!this.options.signal?.aborted) return false;
    if (!this.snapshot.issues.some((issue) => issue.code === "cancelled"))
      this.issue("cancelled", "Source collection cancelled", undefined, true);
    return true;
  }

  request(): boolean {
    if (this.cancelled()) return false;
    if (++this.requests <= this.limits.maxRequests) return true;
    this.issue("request_limit", "Source request limit reached");
    return false;
  }

  beginVerification(): boolean {
    this.verifiedBytes = 0;
    return !this.cancelled();
  }

  canAcquireBytes(size: number, path: string, verifying = false): boolean {
    if (size > this.limits.maxFileBytes) {
      if (verifying)
        this.issue("verification_unavailable", "File exceeds raw verification byte limit", path);
      else this.omit(path, "file_limit", "File exceeds raw byte limit");
      return false;
    }
    const used = verifying ? this.verifiedBytes : this.acquiredBytes;
    if (!Number.isSafeInteger(size) || size < 0 || used + size > this.limits.maxBytes) {
      if (verifying)
        this.issue("verification_unavailable", "Raw verification byte budget exhausted", path);
      else this.omit(path, "byte_limit", "Raw source acquisition byte budget exhausted");
      return false;
    }
    return true;
  }

  reserveBytes(size: number, path: string, verifying = false): boolean {
    if (!this.canAcquireBytes(size, path, verifying)) return false;
    if (verifying) this.verifiedBytes += size;
    else this.acquiredBytes += size;
    return true;
  }

  discover(path: string): boolean {
    if (this.seen.has(path)) return true;
    if (++this.entries > this.limits.maxEntries) {
      this.omit(path, "entry_limit", "Source enumeration limit reached");
      return false;
    }
    this.seen.add(path);
    this.snapshot.discovered.push(path);
    return true;
  }

  omit(path: string, code: string, message: string): void {
    if (!this.snapshot.omitted.includes(path)) this.snapshot.omitted.push(path);
    this.issue(code, message, path);
  }

  add(input: {
    path: string;
    bytes: Uint8Array;
    version: string;
    side?: CodeSide;
    role?: CodeSourceRole;
    provenance: CodeSourceItem["provenance"];
    request?: SourceReadRequest;
    startLine?: number;
    complete?: boolean;
  }): void {
    if (this.cancelled()) return;
    const { path, bytes } = input;
    if (!this.discover(path)) return;
    const identity = byteIdentity(bytes);
    const side = input.side ?? "current";
    const request = input.request;
    const first = request?.startLine ?? input.startLine ?? 1;
    const last = request?.endLine;
    if (
      !Number.isSafeInteger(first) ||
      first < 1 ||
      (last !== undefined && (!Number.isSafeInteger(last) || last < first))
    ) {
      this.issue("invalid_range", "Source line range must be one-based and ordered", path);
      return;
    }
    if (bytes.byteLength > this.limits.maxFileBytes) {
      this.omit(path, "file_limit", "File exceeds raw byte limit");
      return;
    }
    let text: string;
    try {
      if (bytes.includes(0)) throw new Error("NUL byte");
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      this.omit(path, "binary_or_encoding", "Source is binary or is not valid UTF-8");
      return;
    }
    const lines = codeSourceLines(text);
    if (lines[0] === "version https://git-lfs.github.com/spec/v1") {
      this.omit(path, "lfs_pointer", "Git LFS pointer is not the referenced file content");
      return;
    }
    if (request?.kind === "search" && !text.includes(request.query ?? "")) return;
    const origin = input.startLine ?? 1;
    const start = Math.max(first, origin);
    const end = Math.min(last ?? origin + lines.length - 1, origin + lines.length - 1);
    if ((lines.length && start > end) || (!lines.length && first !== origin)) {
      this.issue("range_unavailable", "Requested source lines are unavailable", path);
      return;
    }
    const selected =
      start === origin && end === origin + lines.length - 1
        ? text
        : lines.slice(start - origin, end - origin + 1).join("\n");
    const key = JSON.stringify([path, side, input.version, identity, start, end]);
    if (this.emitted.has(key)) return;
    const size = Buffer.byteLength(selected);
    if (
      this.snapshot.items.length >= this.limits.maxFiles ||
      this.bytes + size > this.limits.maxBytes
    ) {
      this.omit(path, "byte_or_file_limit", "Source output budget exhausted");
      return;
    }
    this.bytes += size;
    this.emitted.add(key);
    this.snapshot.items.push({
      id: `source:${this.namespace}:${createHash("sha256").update(key).digest("hex")}`,
      role: input.role ?? "target",
      path,
      side,
      version: input.version,
      contentIdentity: identity,
      text: selected,
      startLine: start,
      endLine: lines.length ? end : 0,
      complete: (input.complete ?? true) && start === origin && end === origin + lines.length - 1,
      provenance: input.provenance,
    });
  }
}

export function matchesPath(path: string, requested: string): boolean {
  return (
    requested === "" ||
    requested === "." ||
    path === requested ||
    path.startsWith(`${requested.replace(/\/$/, "")}/`)
  );
}

export function validRequest(collector: SourceCollector, request: SourceReadRequest): boolean {
  if (!collector.request()) return false;
  if (
    !request ||
    !["read", "list", "search"].includes(request.kind) ||
    typeof request.path !== "string" ||
    (request.side !== undefined && !["current", "old", "new"].includes(request.side)) ||
    (request.kind === "search" &&
      (typeof request.query !== "string" || request.query.length === 0)) ||
    (request.startLine !== undefined &&
      (!Number.isSafeInteger(request.startLine) || request.startLine < 1)) ||
    (request.endLine !== undefined &&
      (!Number.isSafeInteger(request.endLine) || request.endLine < (request.startLine ?? 1)))
  ) {
    collector.issue("invalid_request", "Invalid source read request");
    return false;
  }
  return true;
}
