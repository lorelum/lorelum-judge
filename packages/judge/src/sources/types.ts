import type { CodeSide, CodeTarget, SourceSnapshot } from "@lorelum/judge-protocol";

export interface SourceLimits {
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  maxEntries: number;
  maxRequests: number;
}

export interface SourceOptions {
  roots?: readonly string[];
  github?: {
    repositories?: readonly string[];
    token?: string;
    fetch?: typeof globalThis.fetch;
  };
  limits?: Partial<SourceLimits>;
  signal?: AbortSignal;
}

export interface SourceReadRequest {
  kind: "read" | "list" | "search";
  path: string;
  side?: CodeSide;
  startLine?: number;
  endLine?: number;
  query?: string;
}

export interface SourceSession {
  snapshot: SourceSnapshot;
  read(request: SourceReadRequest): Promise<void>;
  verify(): Promise<void>;
}

export type DirectTarget = Extract<
  CodeTarget,
  { kind: "snippet" | "files" | "diff" | "comparison" }
>;
