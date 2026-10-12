import {
  ANY_TASK_CLASS,
  type CompilationReport,
  type RubricSet,
  validateCompilationReport,
  validateRubricAgainstContract,
  validateRubricSet,
} from "@lorelum/judge-protocol";

import { type CompileIssue, fromValidation } from "./rubric-helpers.js";
import {
  type GapEntry,
  type GateInput,
  type Proposal,
  TRUSTED_ORIGINS,
} from "./rubric-proposals.js";

export type GateResult =
  | { readonly ok: true; readonly rubric: RubricSet; readonly report: CompilationReport }
  | { readonly ok: false; readonly issues: CompileIssue[] };

export function gateProposals(input: GateInput): GateResult {
  const issues: CompileIssue[] = [];
  const gate = (path: string, code: string, message: string): void => {
    issues.push({ category: "gate", path, code, message });
  };
  const acceptanceIds = new Set(input.contract.acceptance.map((item) => item.id));
  const byId = new Map<string, Proposal>();
  for (const proposal of input.proposals) {
    if (byId.has(proposal.criterion.id)) {
      gate(
        `${proposal.path}.criterion.id`,
        "duplicate_criterion",
        `criterion "${proposal.criterion.id}" is proposed more than once`,
      );
    } else {
      byId.set(proposal.criterion.id, proposal);
    }
  }

  // Per-proposal references. Evidence selectors name acceptance ids, because those are the evidence.
  const survivorOf = new Map<string, string>();
  for (const proposal of input.proposals) {
    proposal.covers.forEach((id, index) => {
      if (!acceptanceIds.has(id)) {
        gate(
          `${proposal.path}.covers[${index}]`,
          "unknown_acceptance",
          `covers "${id}", which is not an acceptance id of the contract`,
        );
      }
    });
    proposal.criterion.evidence.forEach((selector, index) => {
      if (!acceptanceIds.has(selector.evidenceId)) {
        gate(
          `${proposal.path}.criterion.evidence[${index}]`,
          "unknown_evidence",
          `evidence "${selector.evidenceId}" is not an acceptance id of the contract`,
        );
      }
    });
    if (
      proposal.criterion.mandatory &&
      (proposal.criterion.source === undefined ||
        !TRUSTED_ORIGINS.has(proposal.criterion.source.origin))
    ) {
      gate(
        `${proposal.path}.criterion.source`,
        "missing_source",
        "a mandatory criterion needs a user, policy, or contract source",
      );
    }
    proposal.mergedFrom.forEach((id, index) => {
      const at = `${proposal.path}.mergedFrom[${index}]`;
      if (id === proposal.criterion.id) {
        gate(at, "self_merge", "a criterion cannot be merged into itself");
      } else if (!byId.has(id)) {
        gate(at, "unknown_merge", `merges "${id}", which is not a proposed criterion`);
      } else if (survivorOf.has(id)) {
        gate(at, "duplicate_merge", `"${id}" is merged into more than one criterion`);
      } else {
        survivorOf.set(id, proposal.criterion.id);
      }
    });
  }
  for (const proposal of input.proposals) {
    if (proposal.mergedFrom.length > 0 && survivorOf.has(proposal.criterion.id)) {
      gate(
        proposal.path,
        "merge_chain",
        "a criterion that merges others cannot itself be merged away",
      );
    }
  }

  const applies = (proposal: Proposal): boolean =>
    proposal.appliesTo.includes(ANY_TASK_CLASS) ||
    proposal.appliesTo.includes(input.contract.taskClass);

  // A group is a surviving criterion with the criteria merged into it.
  interface Group {
    readonly survivor: Proposal;
    readonly members: readonly Proposal[];
  }
  const groups: Group[] = [];
  for (const proposal of input.proposals) {
    if (survivorOf.has(proposal.criterion.id)) {
      continue;
    }
    const members = proposal.mergedFrom
      .map((id) => byId.get(id))
      .filter((item): item is Proposal => item !== undefined);
    for (const member of members) {
      if (applies(member) !== applies(proposal)) {
        gate(
          proposal.path,
          "merge_across_applicability",
          `merged criterion "${member.criterion.id}" has a different applicability`,
        );
      }
      if (member.criterion.mandatory && !proposal.criterion.mandatory) {
        gate(
          proposal.path,
          "merge_drops_mandatory",
          `merged criterion "${member.criterion.id}" is mandatory; the surviving criterion must be too`,
        );
      }
    }
    groups.push({ survivor: proposal, members });
  }

  const excluded: { criterionId: string; code: "not_applicable" | "conflict"; reason: string }[] =
    [];
  const kept: { id: string; covers: string[]; members: readonly Proposal[]; survivor: Proposal }[] =
    [];
  for (const group of groups) {
    const all = [group.survivor, ...group.members];
    if (!applies(group.survivor)) {
      for (const item of all) {
        excluded.push({
          criterionId: item.criterion.id,
          code: "not_applicable",
          reason: `appliesTo [${item.appliesTo.join(", ")}] does not include task class "${input.contract.taskClass}"`,
        });
      }
      continue;
    }
    // The survivor takes over the acceptance ids of the criteria merged into it. It must select
    // evidence for each of them, so its own evidence list is checked against the union.
    const covers: string[] = [];
    for (const item of all) {
      for (const id of item.covers) {
        if (!covers.includes(id)) {
          covers.push(id);
        }
      }
    }
    const ownEvidence = new Set(
      group.survivor.criterion.evidence.map((selector) => selector.evidenceId),
    );
    for (const id of covers) {
      if (!ownEvidence.has(id)) {
        gate(
          `${group.survivor.path}.criterion.evidence`,
          "covers_without_evidence",
          `covers "${id}" but has no evidence selector for it`,
        );
      }
    }
    kept.push({
      id: group.survivor.criterion.id,
      covers,
      members: group.members,
      survivor: group.survivor,
    });
  }

  // Undeclared conflict, as #41 defines it: two kept groups cover the same acceptance ids with
  // the same evidence selectors (id and role). Both are excluded and the report says why.
  // Identical duplicates fall under the same rule; they are reported, never merged silently.
  // Partial overlap is not a conflict. A second primary owner of one evidence is a gate failure.
  const signature = (item: {
    readonly covers: readonly string[];
    readonly survivor: Proposal;
  }): string =>
    [
      [...item.covers].sort().join(","),
      item.survivor.criterion.evidence
        .map((selector) => `${selector.evidenceId}:${selector.role}`)
        .sort()
        .join(","),
    ].join("|");
  // Criteria with the same covers and evidence form one bucket. A singleton is accepted; a larger
  // bucket is a conflict, so each member is excluded with the others named in the reason.
  // Classification follows `kept` order, so the report order is unchanged.
  type Kept = (typeof kept)[number];
  const buckets = new Map<string, Kept[]>();
  for (const item of kept) {
    const key = signature(item);
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const accepted: Kept[] = [];
  for (const item of kept) {
    const bucket = buckets.get(signature(item)) ?? [item];
    if (bucket.length === 1) {
      accepted.push(item);
      continue;
    }
    const others = bucket
      .filter((other) => other.id !== item.id)
      .map((other) => `"${other.id}"`)
      .join(", ");
    const reason = `has the same covers and evidence as ${others} without a declared merge`;
    for (const id of [item.id, ...item.members.map((member) => member.criterion.id)]) {
      excluded.push({ criterionId: id, code: "conflict", reason });
    }
  }

  // One primary scoring owner per evidence across the rubric (AGENTS 4.3).
  const primaryOwner = new Map<string, string>();
  for (const item of accepted) {
    for (const selector of item.survivor.criterion.evidence) {
      if (selector.role !== "primary") {
        continue;
      }
      const owner = primaryOwner.get(selector.evidenceId);
      if (owner !== undefined && owner !== item.id) {
        gate(
          `${item.survivor.path}.criterion.evidence`,
          "duplicate_primary_evidence",
          `evidence "${selector.evidenceId}" is primary for "${owner}" and "${item.id}"`,
        );
      } else {
        primaryOwner.set(selector.evidenceId, item.id);
      }
    }
  }

  if (accepted.length === 0) {
    gate("$.proposals", "empty_rubric", "no applicable criterion remains to form a rubric");
    for (const item of excluded) {
      gate("$.proposals", item.code, `criterion "${item.criterionId}" excluded: ${item.reason}`);
    }
    for (const gap of input.unsupported) {
      gate("$.unsupported", "unsupported", `"${gap.acceptanceId}": ${gap.reason}`);
    }
  }

  // Coverage.
  const coverage = new Map<string, string[]>();
  for (const item of accepted) {
    for (const acceptanceId of item.covers) {
      if (acceptanceIds.has(acceptanceId)) {
        coverage.set(acceptanceId, [...(coverage.get(acceptanceId) ?? []), item.id]);
      }
    }
  }
  const unsupportedIds = new Set<string>();
  input.unsupported.forEach((gap, index) => {
    const at = `$.unsupported[${index}].acceptanceId`;
    if (!acceptanceIds.has(gap.acceptanceId)) {
      gate(
        at,
        "unknown_acceptance",
        `"${gap.acceptanceId}" is not an acceptance id of the contract`,
      );
    } else if (unsupportedIds.has(gap.acceptanceId)) {
      gate(
        at,
        "duplicate_unsupported",
        `"${gap.acceptanceId}" is declared unsupported more than once`,
      );
    } else if (coverage.has(gap.acceptanceId)) {
      gate(
        at,
        "unsupported_and_covered",
        `"${gap.acceptanceId}" is both covered and declared unsupported`,
      );
    } else {
      unsupportedIds.add(gap.acceptanceId);
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const covered: { acceptanceId: string; criterionIds: string[] }[] = [];
  const uncovered: GapEntry[] = [];
  for (const item of input.contract.acceptance) {
    const ids = coverage.get(item.id);
    if (ids !== undefined) {
      covered.push({ acceptanceId: item.id, criterionIds: ids });
    } else if (!unsupportedIds.has(item.id)) {
      uncovered.push({
        acceptanceId: item.id,
        reason: "no applicable criterion covers this acceptance",
      });
    }
  }
  // Only accepted survivors appear as merges: a conflicted survivor is excluded, not merged.
  const merged = accepted
    .filter((item) => item.members.length > 0)
    .map((item) => ({
      criterionId: item.id,
      mergedFrom: item.members.map((member) => member.criterion.id),
    }));
  const reportCandidate = {
    schema: "lorelum.judge.compilation-report/v1",
    contractIdentity: input.contractIdentity,
    covered,
    uncovered,
    unsupported: input.unsupported.filter((gap) => unsupportedIds.has(gap.acceptanceId)),
    merged,
    excluded,
  };
  const rubricCandidate = {
    schema: "lorelum.judge.rubric-set/v1",
    id: input.rubricId,
    status: "proposal",
    contractIdentity: input.contractIdentity,
    entries: accepted.map((item) => ({
      criterion: item.survivor.criterion,
      covers: item.covers,
      appliesTo: item.survivor.appliesTo,
      role: item.survivor.role,
    })),
  };
  // Candidates are checked before they are typed: the validators return the checked value.
  const rubricCheck = validateRubricSet(rubricCandidate);
  if (!rubricCheck.ok) {
    return { ok: false, issues: fromValidation("gate", "$.rubric", rubricCheck.issues) };
  }
  const agreement = validateRubricAgainstContract(rubricCheck.value, input.contract);
  if (!agreement.ok) {
    return { ok: false, issues: fromValidation("gate", "$.rubric", agreement.issues) };
  }
  const reportCheck = validateCompilationReport(reportCandidate, rubricCheck.value, input.contract);
  if (!reportCheck.ok) {
    return { ok: false, issues: fromValidation("gate", "$.report", reportCheck.issues) };
  }
  return { ok: true, rubric: rubricCheck.value, report: reportCheck.value };
}
