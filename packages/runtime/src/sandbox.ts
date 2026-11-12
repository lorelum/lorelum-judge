export interface SandboxRunRequest {
  root: string;
  /** Project paths whose contents commands may read; adapters may reject unsupported scopes. */
  readPaths: readonly string[];
  writablePaths: readonly string[];
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface SandboxRunResult {
  status: "completed" | "failed" | "cancelled" | "timed_out" | "truncated";
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SandboxPort {
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
