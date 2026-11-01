import { codeSourceLines, type SourceSnapshot } from "./code-evaluation.js";
import { identifyValidated } from "./identity.js";
import schema from "./schemas/code-evaluation.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

const checkSource = compileSchema<SourceSnapshot>({ $ref: `${schema.$id}#/$defs/source` });
const issue = (path: string, message: string): ValidationIssue => ({
  path,
  code: "report_mismatch",
  message,
});

export function validateSourceSnapshot(raw: unknown): ValidationResult<SourceSnapshot> {
  return guarded<ValidationResult<SourceSnapshot>>(() => {
    const value = snapshot(raw);
    if (!checkSource(value)) return { ok: false, issues: schemaIssues(checkSource.errors) };
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();
    value.items.forEach((item, index) => {
      const path = `$.items[${index}]`;
      if (ids.has(item.id))
        issues.push(issue(`${path}.id`, "source ids must be unique across versions"));
      ids.add(item.id);
      const lines = codeSourceLines(item.text).length;
      if (item.endLine !== (lines === 0 ? 0 : item.startLine + lines - 1))
        issues.push(
          issue(
            path,
            "source range must match its text lines (terminal newline is not another line)",
          ),
        );
    });
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}
export const sourceSnapshotIdentity = (raw: unknown) =>
  identifyValidated(validateSourceSnapshot(raw));
