import type { WorkflowDecision } from "./generated/workflow-decision.js";
import type { WorkflowPlan, WorkflowSource } from "./generated/workflow-plan.js";
import { identifyValidated } from "./identity.js";
import type { IdentityOutcome } from "./measurement.js";
import workflowDecisionSchema from "./schemas/workflow-decision.schema.json" with { type: "json" };
import workflowPlanSchema from "./schemas/workflow-plan.schema.json" with { type: "json" };
import { validateTaskContract } from "./task-contract.js";
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

export type { WorkflowDecision, WorkflowPlan, WorkflowSource };

const checkPlan = compileSchema<WorkflowPlan>(workflowPlanSchema);
const checkDecision = compileSchema<WorkflowDecision>(workflowDecisionSchema);

/** Validates a host-reported decision, without authenticating the host or authorizing operations. */
export function validateWorkflowDecision(input: unknown): ValidationResult<WorkflowDecision> {
  return guarded<ValidationResult<WorkflowDecision>>(() => {
    const value = snapshot(input);
    return checkDecision(value)
      ? { ok: true, value }
      : { ok: false, issues: schemaIssues(checkDecision.errors) };
  }, failed);
}

/** Validates the plan shape, task semantics, provenance, and complete acceptance coverage. */
export function validateWorkflowPlan(input: unknown): ValidationResult<WorkflowPlan> {
  return guarded<ValidationResult<WorkflowPlan>>(() => {
    const value = snapshot(input);
    if (!checkPlan(value)) return { ok: false, issues: schemaIssues(checkPlan.errors) };

    const issues: ValidationIssue[] = [];
    const issue = (path: string, message: string) => issues.push({ path, code: "schema", message });
    const task = validateTaskContract(value.task);
    if (!task.ok) issues.push(...prefixIssues(task.issues, "$.task"));

    const sources = new Map<string, WorkflowSource>();
    value.sources.forEach((source, index) => {
      if (sources.has(source.id))
        issue(`$.sources[${index}].id`, `duplicate source id "${source.id}"`);
      sources.set(source.id, source);
    });
    const acceptance = new Set(value.task.acceptance.map((item) => item.id));
    value.task.acceptance.forEach((item, index) => {
      const source = sources.get(item.source.ref);
      if (!source) issue(`$.task.acceptance[${index}].source.ref`, "source does not exist");
      else if (source.status !== "available") {
        issue(`$.task.acceptance[${index}].source.ref`, "acceptance requires an available source");
      }
    });

    for (const kind of ["steps", "checks"] as const) {
      const ids = new Set<string>();
      const covered = new Set<string>();
      value[kind].forEach((item, index) => {
        if (ids.has(item.id)) issue(`$.${kind}[${index}].id`, `duplicate ${kind} id "${item.id}"`);
        ids.add(item.id);
        const refs = new Set<string>();
        item.acceptanceIds.forEach((id, refIndex) => {
          const path = `$.${kind}[${index}].acceptanceIds[${refIndex}]`;
          if (!acceptance.has(id)) issue(path, `unknown acceptance id "${id}"`);
          if (refs.has(id)) issue(path, `duplicate acceptance reference "${id}"`);
          refs.add(id);
          covered.add(id);
        });
      });
      value.task.acceptance.forEach((item, index) => {
        if (!covered.has(item.id))
          issue(`$.task.acceptance[${index}].id`, `acceptance has no ${kind} reference`);
      });
    }
    value.conflicts.forEach((conflict, index) => {
      const refs = new Set<string>();
      conflict.sourceIds.forEach((id, refIndex) => {
        const path = `$.conflicts[${index}].sourceIds[${refIndex}]`;
        if (!sources.has(id)) issue(path, `unknown source id "${id}"`);
        if (refs.has(id)) issue(path, `duplicate source reference "${id}"`);
        refs.add(id);
      });
    });
    return issues.length === 0 ? { ok: true, value } : { ok: false, issues };
  }, failed);
}

/** Covers the entire validated plan, including all source versions, content and order. */
export function workflowPlanIdentity(input: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => identifyValidated(validateWorkflowPlan(input)), failed);
}
