import type { WorkflowSessionEvent } from "./generated/workflow-session-event.js";
import eventSchema from "./schemas/workflow-session-event.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  prefixIssues,
  schemaIssues,
  snapshot,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type { WorkflowSessionEvent };

const checkEvent = compileSchema<WorkflowSessionEvent>(eventSchema);
const stageStatuses: Record<
  WorkflowSessionEvent["stage"],
  readonly WorkflowSessionEvent["status"][]
> = {
  proposed: ["proposed"],
  authorization: ["allowed", "denied"],
  started: ["started"],
  result: ["completed", "failed", "cancelled", "timed_out", "truncated", "unavailable", "unknown"],
  check: [
    "passed",
    "failed",
    "cancelled",
    "timed_out",
    "truncated",
    "unavailable",
    "not_started",
    "unknown",
  ],
  terminal: ["completed", "failed", "cancelled", "timed_out", "unknown"],
};

/** Validates metadata only; it neither authenticates the producer nor grants authority. */
export function validateWorkflowSessionEvent(
  input: unknown,
): ValidationResult<WorkflowSessionEvent> {
  return guarded<ValidationResult<WorkflowSessionEvent>>(() => {
    const value = snapshot(input);
    if (!checkEvent(value)) return { ok: false, issues: schemaIssues(checkEvent.errors) };
    const issues: ValidationIssue[] = [];
    if (!stageStatuses[value.stage].includes(value.status))
      issues.push({
        path: "$.status",
        code: "schema",
        message: "status does not match event stage",
      });
    if (
      value.stage === "terminal"
        ? value.actionId !== null || value.actionKind !== null
        : value.actionId === null || value.actionKind === null
    )
      issues.push({
        path: "$.actionId",
        code: "schema",
        message: "terminal events have no action; other stages require an action id and kind",
      });
    if (value.stage === "check" && value.actionKind !== "check" && value.actionKind !== "review")
      issues.push({
        path: "$.actionKind",
        code: "schema",
        message: "check events require check or review kind",
      });
    return issues.length ? { ok: false, issues } : { ok: true, value };
  }, failed);
}

/** Checks a received batch belongs to one session and is strictly ordered; gaps are allowed. */
export function validateWorkflowSessionEvents(
  input: unknown,
): ValidationResult<WorkflowSessionEvent[]> {
  return guarded<ValidationResult<WorkflowSessionEvent[]>>(() => {
    const value = snapshot(input);
    if (!Array.isArray(value))
      return {
        ok: false,
        issues: [{ path: "$", code: "schema", message: "expected an event array" }],
      };
    const events: WorkflowSessionEvent[] = [];
    const issues: ValidationIssue[] = [];
    value.forEach((item, index) => {
      const event = validateWorkflowSessionEvent(item);
      if (!event.ok) {
        issues.push(...prefixIssues(event.issues, `$[${index}]`));
        return;
      }
      const previous = events[events.length - 1];
      if (previous && event.value.sessionId !== previous.sessionId)
        issues.push({
          path: `$[${index}].sessionId`,
          code: "schema",
          message: "events must belong to one session",
        });
      if (previous && event.value.sequence <= previous.sequence)
        issues.push({
          path: `$[${index}].sequence`,
          code: "schema",
          message: "sequence must strictly increase",
        });
      events.push(event.value);
    });
    return issues.length ? { ok: false, issues } : { ok: true, value: events };
  }, failed);
}
