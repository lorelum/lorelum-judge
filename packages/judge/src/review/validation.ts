import type { ValidationIssue } from "@lorelum/judge-protocol";

export function validation(path: string, message: string): ValidationIssue {
  return { path, code: "schema", message };
}
