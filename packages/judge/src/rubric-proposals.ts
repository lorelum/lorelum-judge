import {
  type Criterion,
  type Identity,
  type TaskContract,
  validateCriterionDraft,
} from "@lorelum/judge-protocol";

import {
  type CompileIssue,
  fromValidation,
  isNonEmpty,
  isRecord,
  safeMessage,
} from "./rubric-helpers.js";

export const TRUSTED_ORIGINS: ReadonlySet<string> = new Set(["user", "policy", "contract"]);
const PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  "criterion",
  "covers",
  "appliesTo",
  "role",
  "mergedFrom",
]);
const OUTPUT_KEYS: ReadonlySet<string> = new Set(["proposals", "unsupported"]);
const GAP_KEYS: ReadonlySet<string> = new Set(["acceptanceId", "reason"]);
export interface Proposal {
  readonly path: string;
  readonly criterion: Criterion;
  readonly covers: readonly string[];
  readonly appliesTo: readonly string[];
  readonly role: "decisive" | "advisory";
  readonly mergedFrom: readonly string[];
}

export interface GapEntry {
  readonly acceptanceId: string;
  readonly reason: string;
}

/** The validated inputs of one gate run. The contract is typed; only the proposals were untrusted. */
export interface GateInput {
  readonly rubricId: string;
  readonly contract: TaskContract;
  readonly contractIdentity: Identity;
  readonly proposals: readonly Proposal[];
  readonly unsupported: readonly GapEntry[];
}

export function readOutput(
  value: unknown,
):
  | { ok: true; value: { proposals: Proposal[]; unsupported: GapEntry[] } }
  | { ok: false; issues: CompileIssue[] } {
  const issues: CompileIssue[] = [];
  const report = (path: string, code: string, message: string): void => {
    issues.push({ category: "output", path, code, message });
  };
  // Array.from visits holes as undefined, so a hole is reported rather than skipped.
  const readList = (raw: unknown, path: string, allowEmpty = false): string[] | undefined => {
    if (!Array.isArray(raw)) {
      report(path, "not_array", "must be an array");
      return undefined;
    }
    const out: string[] = [];
    let ok = true;
    Array.from(raw).forEach((entry, index) => {
      if (!isNonEmpty(entry)) {
        report(`${path}[${index}]`, "invalid_id", "must be a non-empty string");
        ok = false;
      } else if (out.includes(entry)) {
        report(`${path}[${index}]`, "duplicate_id", `"${entry}" appears more than once`);
        ok = false;
      } else {
        out.push(entry);
      }
    });
    if (out.length === 0 && !allowEmpty) {
      report(path, "empty_list", "must not be empty");
      ok = false;
    }
    return ok ? out : undefined;
  };
  try {
    if (!isRecord(value)) {
      report("$", "not_object", "model output must be an object with proposals and unsupported");
      return { ok: false, issues };
    }
    for (const key of Object.keys(value)) {
      if (!OUTPUT_KEYS.has(key)) {
        report(`$.${key}`, "unknown_field", `unknown field "${key}"`);
      }
    }
    const rawProposals = value.proposals;
    const rawUnsupported = value.unsupported;
    const proposals: Proposal[] = [];
    if (!Array.isArray(rawProposals)) {
      report("$.proposals", "not_array", "must be an array");
    } else {
      Array.from(rawProposals).forEach((raw, index) => {
        const path = `$.proposals[${index}]`;
        if (!isRecord(raw)) {
          report(path, "not_object", "proposal must be an object");
          return;
        }
        for (const key of Object.keys(raw)) {
          if (!PROPOSAL_KEYS.has(key)) {
            report(`${path}.${key}`, "unknown_field", `unknown field "${key}"`);
          }
        }
        // Each field is read once. A getter that returns different values on later reads
        // cannot make the checked value differ from the kept value.
        const criterionRaw = raw.criterion;
        const coversRaw = raw.covers;
        const appliesToRaw = raw.appliesTo;
        const mergedRaw = raw.mergedFrom;
        const role = raw.role;
        const criterion = validateCriterionDraft(criterionRaw);
        if (!criterion.ok) {
          issues.push(...fromValidation("output", `${path}.criterion`, criterion.issues));
        }
        const covers = readList(coversRaw, `${path}.covers`);
        const appliesTo = readList(appliesToRaw, `${path}.appliesTo`);
        const mergedFrom =
          mergedRaw === undefined ? [] : readList(mergedRaw, `${path}.mergedFrom`, true);
        const validRole = role === "decisive" || role === "advisory";
        if (!validRole) {
          report(`${path}.role`, "invalid_role", 'role must be "decisive" or "advisory"');
        }
        if (
          criterion.ok &&
          covers &&
          appliesTo &&
          mergedFrom &&
          (role === "decisive" || role === "advisory")
        ) {
          proposals.push({ path, criterion: criterion.value, covers, appliesTo, role, mergedFrom });
        }
      });
    }
    const unsupported: GapEntry[] = [];
    if (!Array.isArray(rawUnsupported)) {
      report("$.unsupported", "not_array", "must be an array");
    } else {
      Array.from(rawUnsupported).forEach((raw, index) => {
        const path = `$.unsupported[${index}]`;
        if (!isRecord(raw)) {
          report(path, "not_object", "entry must be an object");
          return;
        }
        for (const key of Object.keys(raw)) {
          if (!GAP_KEYS.has(key)) {
            report(`${path}.${key}`, "unknown_field", `unknown field "${key}"`);
          }
        }
        // Each field is read once, so the value that is checked is the value that is kept.
        const acceptanceId = raw.acceptanceId;
        const reason = raw.reason;
        if (!isNonEmpty(acceptanceId)) {
          report(`${path}.acceptanceId`, "invalid_id", "must be a non-empty string");
        } else if (!isNonEmpty(reason)) {
          report(`${path}.reason`, "invalid_reason", "must be a non-blank string");
        } else {
          unsupported.push({ acceptanceId, reason });
        }
      });
    }
    if (issues.length > 0) {
      return { ok: false, issues };
    }
    return { ok: true, value: { proposals, unsupported } };
  } catch (error) {
    report("$", "unreadable", `model output could not be read: ${safeMessage(error)}`);
    return { ok: false, issues };
  }
}
