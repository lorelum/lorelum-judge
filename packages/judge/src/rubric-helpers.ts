/**
 * `model`: the port threw, or the signal aborted. `output`: the response is not a valid
 * proposal set. `gate`: a deterministic rule failed. `prompt`: the contract could not be
 * rendered in full.
 */
export type CompileCategory = "model" | "output" | "gate" | "prompt";

export interface CompileIssue {
  readonly category: CompileCategory;
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export function failure(issues: readonly CompileIssue[]): {
  readonly ok: false;
  readonly issues: readonly CompileIssue[];
} {
  return { ok: false, issues };
}

export function fromValidation(
  category: CompileCategory,
  base: string,
  issues: readonly { readonly path: string; readonly code: string; readonly message: string }[],
): CompileIssue[] {
  return issues.map((issue) => ({
    category,
    path: rebase(base, issue.path),
    code: issue.code,
    message: issue.message,
  }));
}

export function rebase(base: string, path: string): string {
  if (path === "$") {
    return base;
  }
  return path.startsWith("$") ? `${base}${path.slice(1)}` : `${base}.${path}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function safeMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unknown error";
  }
}
