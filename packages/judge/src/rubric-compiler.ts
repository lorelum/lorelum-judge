import {
  ANY_TASK_CLASS,
  type CompilationReport,
  type Criterion,
  type Identity,
  type InstrumentProfile,
  type RubricSet,
  rubricIdentity,
  taskContractIdentity,
  validateCompilationReport,
  validateCriterionDraft,
  validateRubricAgainstContract,
  validateRubricSet,
  validateTaskContract,
} from "@lorelum/judge-protocol";
import type { ModelPort, ModelResponse } from "@lorelum/judge-runtime";

import { compilePrompt, type EvidenceMaterial, type PromptSpec } from "./prompt-compiler.js";

/** Compiler-owned text appended to the caller's system prompt. It is part of the prompt identity. */
export const RUBRIC_OUTPUT_INSTRUCTION = [
  "Rubric compiler v1. Propose criteria that judge whether the task's acceptance items are met.",
  "The acceptance items are the evidence blocks in the user message, identified by their ids.",
  "Reply with one JSON object and nothing else:",
  '{"proposals":[{"criterion":<criterion>,"covers":[<acceptance id>],"appliesTo":[<task class or "*">],"role":"decisive" or "advisory","mergedFrom":[<criterion id of another proposal>]}],"unsupported":[{"acceptanceId":<acceptance id>,"reason":<why no criterion can judge it>}]}',
  '"mergedFrom" is optional. A criterion is {"schema":"lorelum.judge.criterion/v1","id","kind":"contract" or "quality" or "comparison","description","mandatory","source":{"origin":"user" or "policy" or "contract","ref"},"anchors":[{"verdict","description"}],"evidence":[{"evidenceId","role":"primary" or "reference"}]}.',
  "Cover only acceptance ids that appear in the evidence. Each covered id needs an evidence entry with the same id.",
].join("\n");

const TRUSTED_ORIGINS: ReadonlySet<string> = new Set(["user", "policy", "contract"]);
const PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  "criterion",
  "covers",
  "appliesTo",
  "role",
  "mergedFrom",
]);
const OUTPUT_KEYS: ReadonlySet<string> = new Set(["proposals", "unsupported"]);
const GAP_KEYS: ReadonlySet<string> = new Set(["acceptanceId", "reason"]);
const IDENTITY = /^sha256:[0-9a-f]{64}$/;
/** Results that compileRubric itself returned. Only these can be frozen. */
const compiledResults = new WeakSet<CompiledRubric>();

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

export type InstrumentFields = Omit<InstrumentProfile, "promptIdentity">;

export interface CompileRubricInput {
  readonly rubricId: string;
  /** A task contract; validated before use. */
  readonly contract: unknown;
  /** The caller's system text and template. The compiler appends its output instruction. */
  readonly prompt: PromptSpec;
  /** Model, decoding, runtime, and repetitions. `promptIdentity` is filled in by the compiler. */
  readonly instrument: InstrumentFields;
  /** A `sha256:` identity of the repository context. Supplied, not verified. */
  readonly contextIdentity: string;
  /** A `sha256:` identity of the authoring policy. Supplied, not verified. */
  readonly policyIdentity: string;
  readonly model: ModelPort;
  readonly runId: string;
  readonly stepIndex: number;
  readonly signal: AbortSignal;
}

export interface RubricBinding {
  readonly contract: unknown;
  readonly contextIdentity: string;
  readonly instrument: unknown;
  readonly policyIdentity: string;
}

export interface CompiledRubric {
  /** Always `status: "proposal"`. Freezing is a separate step. */
  readonly rubric: RubricSet;
  readonly report: CompilationReport;
  readonly rubricIdentity: Identity;
  readonly binding: RubricBinding;
}

export type CompileRubricResult =
  | { readonly ok: true; readonly value: CompiledRubric }
  | { readonly ok: false; readonly issues: readonly CompileIssue[] };

export type FreezeResult =
  | { readonly ok: true; readonly rubric: RubricSet; readonly rubricIdentity: Identity }
  | { readonly ok: false; readonly issues: readonly CompileIssue[] };

/** True when the report has no uncovered, unsupported, or conflicting acceptance. */
export function isComplete(report: CompilationReport): boolean {
  return (
    report.uncovered.length === 0 &&
    report.unsupported.length === 0 &&
    report.excluded.every((item) => item.code !== "conflict")
  );
}

/** Compiles a proposal rubric. Never throws; every failure is an issue with a category. */
export async function compileRubric(input: CompileRubricInput): Promise<CompileRubricResult> {
  try {
    return await run(input);
  } catch (error) {
    return failure([
      {
        category: "gate",
        path: "$",
        code: "internal",
        message: `unexpected failure: ${safeMessage(error)}`,
      },
    ]);
  }
}

/** Freezes a complete proposal whose criteria all have anchors. Recomputes identity for the frozen status. */
export function freezeRubric(compiled: CompiledRubric): FreezeResult {
  if (!compiledResults.has(compiled)) {
    return {
      ok: false,
      issues: [
        {
          category: "gate",
          path: "$",
          code: "not_compiled",
          message:
            "only a result returned by compileRubric can be frozen; copies and hand-built objects cannot",
        },
      ],
    };
  }
  const issues: CompileIssue[] = [];
  const reportCheck = validateCompilationReport(
    compiled.report,
    compiled.rubric,
    compiled.binding.contract,
  );
  if (!reportCheck.ok) {
    return { ok: false, issues: fromValidation("gate", "$.report", reportCheck.issues) };
  }
  if (!isComplete(compiled.report)) {
    for (const gap of compiled.report.uncovered) {
      issues.push({
        category: "gate",
        path: "$.report.uncovered",
        code: "incomplete",
        message: `acceptance "${gap.acceptanceId}" is uncovered`,
      });
    }
    for (const gap of compiled.report.unsupported) {
      issues.push({
        category: "gate",
        path: "$.report.unsupported",
        code: "incomplete",
        message: `acceptance "${gap.acceptanceId}" is unsupported`,
      });
    }
    for (const item of compiled.report.excluded) {
      if (item.code === "conflict") {
        issues.push({
          category: "gate",
          path: "$.report.excluded",
          code: "incomplete",
          message: `criterion "${item.criterionId}" conflicts: ${item.reason}`,
        });
      }
    }
  }
  compiled.rubric.entries.forEach((entry, index) => {
    if (entry.criterion.anchors.length === 0) {
      issues.push({
        category: "gate",
        path: `$.entries[${index}].criterion.anchors`,
        code: "no_anchors",
        message: `criterion "${entry.criterion.id}" has no anchors`,
      });
    }
  });
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const frozen = { ...compiled.rubric, status: "frozen" } as RubricSet;
  const checked = validateRubricSet(frozen);
  if (!checked.ok) {
    return { ok: false, issues: fromValidation("gate", "$", checked.issues) };
  }
  const identity = rubricIdentity(frozen, compiled.binding);
  if (!identity.ok) {
    return { ok: false, issues: fromValidation("gate", "$", identity.issues) };
  }
  return { ok: true, rubric: frozen, rubricIdentity: identity.identity };
}

interface Proposal {
  readonly path: string;
  readonly criterion: Criterion;
  readonly covers: readonly string[];
  readonly appliesTo: readonly string[];
  readonly role: "decisive" | "advisory";
  readonly mergedFrom: readonly string[];
}

interface GapEntry {
  readonly acceptanceId: string;
  readonly reason: string;
}

async function run(input: CompileRubricInput): Promise<CompileRubricResult> {
  if (!isNonEmpty(input.rubricId)) {
    return failure([
      {
        category: "gate",
        path: "$.rubricId",
        code: "invalid_id",
        message: "rubric id must be non-empty",
      },
    ]);
  }
  if (typeof input.contextIdentity !== "string" || !IDENTITY.test(input.contextIdentity)) {
    return failure([
      {
        category: "gate",
        path: "$.contextIdentity",
        code: "invalid_identity",
        message: "must be a sha256 identity",
      },
    ]);
  }
  if (typeof input.policyIdentity !== "string" || !IDENTITY.test(input.policyIdentity)) {
    return failure([
      {
        category: "gate",
        path: "$.policyIdentity",
        code: "invalid_identity",
        message: "must be a sha256 identity",
      },
    ]);
  }
  const contractResult = validateTaskContract(input.contract);
  if (!contractResult.ok) {
    return failure(fromValidation("gate", "$.contract", contractResult.issues));
  }
  const contract = contractResult.value;
  const contractId = taskContractIdentity(contract);
  if (!contractId.ok) {
    return failure(fromValidation("gate", "$.contract", contractId.issues));
  }

  const evidence: EvidenceMaterial[] = contract.acceptance.map((item) => ({
    id: item.id,
    status: "present",
    text: item.text,
  }));
  const prompt: PromptSpec = {
    ...input.prompt,
    system: `${input.prompt.system}\n\n${RUBRIC_OUTPUT_INSTRUCTION}`,
  };
  const compiled = compilePrompt({ prompt, evidence });
  if (!compiled.ok) {
    return failure(
      compiled.issues.map((issue) => ({
        category: "prompt",
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  const unrendered: CompileIssue[] = [];
  for (const item of compiled.value.manifest.items) {
    if (item.render?.state !== "rendered") {
      unrendered.push({
        category: "prompt",
        path: "$.contract.acceptance",
        code: "acceptance_not_rendered",
        message: `acceptance "${item.id}" is ${item.render?.state ?? "not rendered"}; the model is not called for a partial contract`,
      });
    }
  }
  if (unrendered.length > 0) {
    return failure(unrendered);
  }

  if (input.signal.aborted) {
    return failure([
      {
        category: "model",
        path: "$.signal",
        code: "aborted",
        message: "compilation was aborted before the model call",
      },
    ]);
  }
  let response: ModelResponse;
  try {
    response = await input.model.generate({
      runId: input.runId,
      stepIndex: input.stepIndex,
      messages: compiled.value.messages,
      tools: [],
      signal: input.signal,
    });
  } catch (error) {
    return failure([
      {
        category: "model",
        path: "$.model",
        code: "model_error",
        message: `model call failed: ${safeMessage(error)}`,
      },
    ]);
  }
  if (input.signal.aborted) {
    return failure([
      {
        category: "model",
        path: "$.signal",
        code: "aborted",
        message: "compilation was aborted during the model call",
      },
    ]);
  }

  // The response is untrusted: reading it can throw, and that is an output failure.
  let kind: unknown;
  let value: unknown;
  try {
    kind = response.kind;
    value = response.kind === "structured" ? response.value : undefined;
  } catch (error) {
    return failure([
      {
        category: "output",
        path: "$.response",
        code: "unreadable",
        message: `model response could not be read: ${safeMessage(error)}`,
      },
    ]);
  }
  if (kind !== "structured") {
    const name = typeof kind === "string" ? kind : "unknown";
    return failure([
      {
        category: "output",
        path: "$.response",
        code: "not_structured",
        message: `expected a structured response, got "${name}"`,
      },
    ]);
  }

  const parsed = readOutput(value);
  if (!parsed.ok) {
    return failure(parsed.issues);
  }

  const gated = gateProposals({
    rubricId: input.rubricId,
    contract,
    contractIdentity: contractId.identity,
    proposals: parsed.value.proposals,
    unsupported: parsed.value.unsupported,
  });
  if (!gated.ok) {
    return failure(gated.issues);
  }

  const instrument = { ...input.instrument, promptIdentity: compiled.value.promptIdentity };
  const binding: RubricBinding = {
    contract,
    contextIdentity: input.contextIdentity,
    instrument,
    policyIdentity: input.policyIdentity,
  };
  const identity = rubricIdentity(gated.rubric, binding);
  if (!identity.ok) {
    return failure(fromValidation("gate", "$", identity.issues));
  }
  const compiledRubric: CompiledRubric = {
    rubric: gated.rubric,
    report: gated.report,
    rubricIdentity: identity.identity,
    binding,
  };
  compiledResults.add(compiledRubric);
  return { ok: true, value: compiledRubric };
}

function readOutput(
  value: unknown,
):
  | { ok: true; value: { proposals: Proposal[]; unsupported: GapEntry[] } }
  | { ok: false; issues: CompileIssue[] } {
  const issues: CompileIssue[] = [];
  const report = (path: string, code: string, message: string): void => {
    issues.push({ category: "output", path, code, message });
  };
  const readList = (raw: unknown, path: string, allowEmpty = false): string[] | undefined => {
    if (!Array.isArray(raw)) {
      report(path, "not_array", "must be an array");
      return undefined;
    }
    const out: string[] = [];
    let ok = true;
    raw.forEach((entry, index) => {
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
      rawProposals.forEach((raw, index) => {
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
      rawUnsupported.forEach((raw, index) => {
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

interface GateInput {
  readonly rubricId: string;
  readonly contract: {
    readonly taskClass: string;
    readonly acceptance: readonly { readonly id: string }[];
  };
  readonly contractIdentity: Identity;
  readonly proposals: readonly Proposal[];
  readonly unsupported: readonly GapEntry[];
}

type GateResult =
  | { readonly ok: true; readonly rubric: RubricSet; readonly report: CompilationReport }
  | { readonly ok: false; readonly issues: CompileIssue[] };

function gateProposals(input: GateInput): GateResult {
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
    const covers: string[] = [];
    for (const item of all) {
      for (const id of item.covers) {
        if (!covers.includes(id)) {
          covers.push(id);
        }
      }
    }
    // Every acceptance an entry covers needs its own evidence selector on that entry.
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

  // Undeclared conflict, as #41 defines it: two kept groups cover the same acceptance ids
  // with the same evidence selectors (id and role). Neither is kept; the report says why.
  // Partial overlap is not a conflict; a second primary owner of one evidence is a gate failure.
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
  const bySignature = new Map<string, string[]>();
  for (const item of kept) {
    const key = signature(item);
    bySignature.set(key, [...(bySignature.get(key) ?? []), item.id]);
  }
  const conflicted = new Map<string, Set<string>>();
  for (const ids of bySignature.values()) {
    if (ids.length > 1) {
      for (const id of ids) {
        conflicted.set(id, new Set(ids.filter((other) => other !== id)));
      }
    }
  }
  const accepted = kept.filter((item) => !conflicted.has(item.id));
  for (const item of kept) {
    const others = conflicted.get(item.id);
    if (others !== undefined) {
      const reason = `has the same covers and evidence as ${[...others].map((id) => `"${id}"`).join(", ")} without a declared merge`;
      for (const id of [item.id, ...item.members.map((member) => member.criterion.id)]) {
        excluded.push({ criterionId: id, code: "conflict", reason });
      }
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
  const merged = kept
    .filter((item) => item.members.length > 0)
    .map((item) => ({
      criterionId: item.id,
      mergedFrom: item.members.map((member) => member.criterion.id),
    }));
  const report = {
    schema: "lorelum.judge.compilation-report/v1",
    contractIdentity: input.contractIdentity,
    covered,
    uncovered,
    unsupported: input.unsupported.filter((gap) => unsupportedIds.has(gap.acceptanceId)),
    merged,
    excluded,
  } as unknown as CompilationReport;
  const rubric = {
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
  } as unknown as RubricSet;

  const rubricCheck = validateRubricSet(rubric);
  if (!rubricCheck.ok) {
    return { ok: false, issues: fromValidation("gate", "$.rubric", rubricCheck.issues) };
  }
  const agreement = validateRubricAgainstContract(rubric, input.contract);
  if (!agreement.ok) {
    return { ok: false, issues: fromValidation("gate", "$.rubric", agreement.issues) };
  }
  const reportCheck = validateCompilationReport(report, rubric, input.contract);
  if (!reportCheck.ok) {
    return { ok: false, issues: fromValidation("gate", "$.report", reportCheck.issues) };
  }
  return { ok: true, rubric, report };
}

function failure(issues: readonly CompileIssue[]): {
  readonly ok: false;
  readonly issues: readonly CompileIssue[];
} {
  return { ok: false, issues };
}

function fromValidation(
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

function rebase(base: string, path: string): string {
  if (path === "$") {
    return base;
  }
  return path.startsWith("$") ? `${base}${path.slice(1)}` : `${base}.${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unknown error";
  }
}
