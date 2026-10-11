import type { TaskContract } from "./generated/task-contract.js";
import { identityOf } from "./identity.js";
import type { JsonValue } from "./json.js";
import type { IdentityOutcome } from "./measurement.js";
import taskContractSchema from "./schemas/task-contract.schema.json" with { type: "json" };
import {
  compileSchema,
  failed,
  guarded,
  schemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type { TaskContract };

/** The task class that means "applies to every class". It is never a real class. */
export const ANY_TASK_CLASS = "*";

const checkContract = compileSchema<TaskContract>(taskContractSchema);

/**
 * Validates a task contract: acceptance ids are unique, every acceptance item has a
 * source, and `taskClass` is a real class rather than the wildcard.
 */
export function validateTaskContract(input: unknown): ValidationResult<TaskContract> {
  return guarded<ValidationResult<TaskContract>>(() => checkContractShape(input), failed);
}

function checkContractShape(input: unknown): ValidationResult<TaskContract> {
  if (!checkContract(input)) {
    return { ok: false, issues: schemaIssues(checkContract.errors) };
  }
  const issues: ValidationIssue[] = [];
  if (input.taskClass === ANY_TASK_CLASS) {
    issues.push({
      path: "$.taskClass",
      code: "invalid_applicability",
      message: `"${ANY_TASK_CLASS}" means every class and cannot be a task's own class`,
    });
  }
  const seen = new Set<string>();
  for (const [index, item] of input.acceptance.entries()) {
    if (seen.has(item.id)) {
      issues.push({
        path: `$.acceptance[${index}].id`,
        code: "duplicate_acceptance",
        message: `acceptance id "${item.id}" is used more than once`,
      });
    }
    seen.add(item.id);
  }
  return issues.length === 0 ? { ok: true, value: input } : { ok: false, issues };
}

/**
 * Identity of a validated contract. The order of acceptance items does not matter; any
 * change to the task class, text, or an acceptance item's id, text, or source does.
 */
export function taskContractIdentity(input: unknown): IdentityOutcome {
  return guarded<IdentityOutcome>(() => identifyContract(input), failed);
}

function identifyContract(input: unknown): IdentityOutcome {
  const contract = validateTaskContract(input);
  if (!contract.ok) {
    return contract;
  }
  const normalized = {
    ...contract.value,
    acceptance: [...contract.value.acceptance].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  };
  const result = identityOf(contract.value.schema, normalized as unknown as JsonValue);
  return result.ok
    ? { ok: true, identity: result.identity }
    : {
        ok: false,
        issues: [
          {
            path: result.error.path,
            code: "schema",
            message: `identity: ${result.error.reason}`,
          },
        ],
      };
}
