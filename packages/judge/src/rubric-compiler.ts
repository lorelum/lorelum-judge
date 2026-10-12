import {
  type CompilationReport,
  type Identity,
  type InstrumentProfile,
  type RubricSet,
  rubricIdentity,
  type TaskContract,
  taskContractIdentity,
  validateCompilationReport,
  validateInstrument,
  validateRubricSet,
  validateTaskContract,
} from "@lorelum/judge-protocol";
import type { ModelPort, ModelResponse } from "@lorelum/judge-runtime";

import { compilePrompt, type EvidenceMaterial, type PromptSpec } from "./prompt-compiler.js";
import { gateProposals } from "./rubric-gate.js";
import {
  type CompileIssue,
  failure,
  fromValidation,
  isNonEmpty,
  safeMessage,
} from "./rubric-helpers.js";
import { type GateInput, readOutput } from "./rubric-proposals.js";

export type { CompileCategory, CompileIssue } from "./rubric-helpers.js";

/**
 * Writes a task class as a JSON string with every non-ASCII code unit escaped (`\uXXXX`). The
 * result is pure ASCII, so the NFC normalization that `compilePrompt` applies to the system text
 * cannot change it. The escaped form is what the model sees and must copy back.
 */
function asciiJsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Compiler-owned text appended to the caller's system prompt. It names the contract's task class
 * and the matching rule for `appliesTo`, so the model can produce entries the gate will accept.
 * The class is written as an ASCII JSON string, so its exact characters are visible, cannot end
 * the instruction early, and survive NFC normalization. The text is part of the prompt identity.
 */
export function rubricOutputInstruction(taskClass: string): string {
  const cls = asciiJsonString(taskClass);
  return [
    "Rubric compiler v1. Propose criteria that judge whether the task's acceptance items are met.",
    "The acceptance items are the evidence blocks in the user message, identified by their ids.",
    `The task class of this contract is ${cls}.`,
    `Each proposal's appliesTo must list ${cls} exactly, or "*" to apply to every task class.`,
    "Matching is exact and case-sensitive. Do not use a similar or shortened name.",
    "Reply with one JSON object and nothing else:",
    '{"proposals":[{"criterion":<criterion>,"covers":[<acceptance id>],"appliesTo":[<task class or "*">],"role":"decisive" or "advisory","mergedFrom":[<criterion id of another proposal>]}],"unsupported":[{"acceptanceId":<acceptance id>,"reason":<why no criterion can judge it>}]}',
    '"mergedFrom" is optional. A criterion is {"schema":"lorelum.judge.criterion/v1","id","kind":"contract" or "quality" or "comparison","description","mandatory","source":{"origin":"user" or "policy" or "contract","ref"},"anchors":[{"verdict","description"}],"evidence":[{"evidenceId","role":"primary" or "reference"}]}.',
    "Cover only acceptance ids that appear in the evidence. Each covered id needs an evidence entry with the same id.",
  ].join("\n");
}

const IDENTITY = /^sha256:[0-9a-f]{64}$/;

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

/** What a compiled rubric is bound to. Its contract and instrument are the validated, copied values. */
export interface CompiledRubricBinding {
  readonly contract: TaskContract;
  readonly contextIdentity: string;
  readonly instrument: InstrumentProfile;
  readonly policyIdentity: string;
}

export interface CompiledRubric {
  /** Always `status: "proposal"`. Freezing is a separate step. */
  readonly rubric: RubricSet;
  readonly report: CompilationReport;
  readonly rubricIdentity: Identity;
  readonly binding: CompiledRubricBinding;
}

export type CompileRubricResult =
  | { readonly ok: true; readonly value: CompiledRubric }
  | { readonly ok: false; readonly issues: readonly CompileIssue[] };

export type FreezeResult =
  | { readonly ok: true; readonly rubric: RubricSet; readonly rubricIdentity: Identity }
  | { readonly ok: false; readonly issues: readonly CompileIssue[] };

/**
 * Results that compileRubric returned. Each is deep-frozen, so its contents cannot change after
 * the compiler produced it; membership therefore means "exactly what the compiler built".
 */
const compiledResults = new WeakSet<CompiledRubric>();

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
  try {
    return freezeChecked(compiled);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          category: "gate",
          path: "$",
          code: "internal",
          message: `unexpected failure: ${safeMessage(error)}`,
        },
      ],
    };
  }
}

function freezeChecked(compiled: CompiledRubric): FreezeResult {
  if (!compiledResults.has(compiled)) {
    return refuseFreeze("not_compiled", "only a result returned by compileRubric can be frozen");
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
  // Validate the frozen candidate; return the validator's typed value, not a cast.
  const checked = validateRubricSet({ ...compiled.rubric, status: "frozen" });
  if (!checked.ok) {
    return { ok: false, issues: fromValidation("gate", "$", checked.issues) };
  }
  const frozen = deepFreeze(checked.value);
  const identity = rubricIdentity(frozen, compiled.binding);
  if (!identity.ok) {
    return { ok: false, issues: fromValidation("gate", "$", identity.issues) };
  }
  return { ok: true, rubric: frozen, rubricIdentity: identity.identity };
}

function refuseFreeze(code: string, message: string): FreezeResult {
  return { ok: false, issues: [{ category: "gate", path: "$", code, message }] };
}

async function run(raw: CompileRubricInput): Promise<CompileRubricResult> {
  // Every field is read once, here. Each later check and use sees the value that was checked.
  const input: CompileRubricInput = {
    rubricId: raw.rubricId,
    contract: raw.contract,
    prompt: raw.prompt,
    instrument: raw.instrument,
    contextIdentity: raw.contextIdentity,
    policyIdentity: raw.policyIdentity,
    model: raw.model,
    runId: raw.runId,
    stepIndex: raw.stepIndex,
    signal: raw.signal,
  };
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
  // The caller's prompt is read once; every field used below comes from this single read.
  const callerPrompt = input.prompt;
  const prompt: PromptSpec = {
    ...callerPrompt,
    system: `${callerPrompt.system}\n\n${rubricOutputInstruction(contract.taskClass)}`,
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

  // The instrument is copied and validated here, so the result never holds the caller's object.
  let instrumentSource: unknown;
  try {
    instrumentSource = { ...input.instrument, promptIdentity: compiled.value.promptIdentity };
  } catch (error) {
    return failure([
      {
        category: "gate",
        path: "$.instrument",
        code: "unreadable",
        message: `instrument could not be read: ${safeMessage(error)}`,
      },
    ]);
  }
  const instrumentResult = validateInstrument(instrumentSource);
  if (!instrumentResult.ok) {
    return failure(fromValidation("gate", "$.instrument", instrumentResult.issues));
  }
  const instrument = instrumentResult.value;

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
    value = kind === "structured" ? (response as { readonly value: unknown }).value : undefined;
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

  const gateInput: GateInput = {
    rubricId: input.rubricId,
    contract,
    contractIdentity: contractId.identity,
    proposals: parsed.value.proposals,
    unsupported: parsed.value.unsupported,
  };
  const gated = gateProposals(gateInput);
  if (!gated.ok) {
    return failure(gated.issues);
  }

  const binding: CompiledRubricBinding = {
    contract,
    contextIdentity: input.contextIdentity,
    instrument,
    policyIdentity: input.policyIdentity,
  };
  const identity = rubricIdentity(gated.rubric, binding);
  if (!identity.ok) {
    return failure(fromValidation("gate", "$", identity.issues));
  }
  const compiledRubric: CompiledRubric = deepFreeze({
    rubric: gated.rubric,
    report: gated.report,
    rubricIdentity: identity.identity,
    binding,
  });
  compiledResults.add(compiledRubric);
  return { ok: true, value: compiledRubric };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
