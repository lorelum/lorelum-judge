import { assessVerdicts, type ReviewAttempt } from "@lorelum/judge-protocol";
import type { ModelResponseMetadata } from "@lorelum/judge-runtime";

import { parseReviewResponse } from "../review-parser.js";
import {
  providerFailure,
  ReviewAbortError,
  readCheckerOutput,
  responseFacts,
  safeFailureMessage,
  unknownFacts,
  withAttemptBoundary,
} from "./attempt.js";
import type { Assessed } from "./findings.js";
import { generationFor, llmRequestFacts } from "./input.js";
import {
  type AttemptContext,
  cancelledAttempt,
  completedAttempt,
  failedAttempt,
  partialAttempt,
} from "./record.js";
import type { LlmFacts, PreparedReview, ReviewFailure, ReviewPorts } from "./types.js";

function assess(
  definition: PreparedReview["definition"],
  rawVerdicts: readonly unknown[],
  bundle: PreparedReview["manifest"],
): Assessed {
  return assessVerdicts(definition.criteria, rawVerdicts, {
    bundle,
    requireAll: true,
  });
}

function checkerFailure(error: unknown): ReviewFailure {
  let rawMessage = "";
  try {
    rawMessage = error instanceof Error ? error.message : "";
  } catch {
    rawMessage = "";
  }
  return {
    category: "execution",
    code: "checker_error",
    message: safeFailureMessage(rawMessage),
  };
}

function llmFacts(
  request: NonNullable<ReturnType<typeof llmRequestFacts>>,
  response: ModelResponseMetadata | undefined,
  invalid: boolean,
): LlmFacts {
  return {
    request,
    ...(response === undefined ? {} : { response }),
    unknowns: unknownFacts(response, invalid),
  };
}

export interface AttemptOutcome {
  readonly attempt: ReviewAttempt;
  readonly assessed?: Assessed;
}

export async function executeAttempt(
  prepared: PreparedReview,
  ports: ReviewPorts,
  activeSignal: AbortSignal,
  context: AttemptContext,
  executionId: string,
  nextId: (prefix: string) => string,
  clock: { now(): Date },
): Promise<AttemptOutcome> {
  const { method, manifest, materials, definition, promptIdentity, renderIdentity, timeoutMs } =
    prepared;
  const attemptController = new AbortController();
  const abortAttempt = () => attemptController.abort();
  activeSignal.addEventListener("abort", abortAttempt, { once: true });
  if (activeSignal.aborted) attemptController.abort();
  const request =
    method.kind === "llm"
      ? llmRequestFacts(method, promptIdentity, renderIdentity, timeoutMs)
      : undefined;
  const finished = (current = context) => ({
    ...current,
    finishedAt: clock.now().toISOString(),
  });

  try {
    let raw: readonly unknown[] | undefined;
    let responseMetadata: ModelResponseMetadata | undefined;
    let responseMetadataInvalid = false;

    if (method.kind === "program") {
      const checker = ports.checker;
      if (checker === undefined) throw new Error("missing checker port");
      const output = await withAttemptBoundary(
        Promise.resolve(
          checker({ definition, evidence: materials, signal: attemptController.signal }),
        ),
        attemptController.signal,
        timeoutMs,
        () => attemptController.abort(),
      );
      raw = readCheckerOutput(output);
      if (raw === undefined) {
        return {
          attempt: failedAttempt(finished(), {
            category: "execution",
            code: "invalid_checker_output",
            message: "the checker did not return a verdict list",
          }),
        };
      }
    } else {
      const modelPort = ports.model;
      if (modelPort === undefined) throw new Error("missing model port");
      const response = await withAttemptBoundary(
        modelPort.generate({
          runId: executionId,
          stepIndex: context.index,
          messages: prepared.messages ?? [],
          tools: [],
          signal: attemptController.signal,
          config: generationFor(method),
        }),
        attemptController.signal,
        timeoutMs,
        () => attemptController.abort(),
      );
      const facts = responseFacts(response);
      if (facts === undefined) {
        return {
          attempt: failedAttempt(
            finished(),
            {
              category: "provider",
              code: "unsupported_response_kind",
              message: "the model did not return a text message",
            },
            request === undefined ? {} : { llm: llmFacts(request, undefined, false) },
          ),
        };
      }
      responseMetadata = facts.metadata;
      responseMetadataInvalid = facts.invalidMetadata;
      const factsForRecord =
        request === undefined
          ? undefined
          : llmFacts(request, facts.metadata, facts.invalidMetadata);
      if (facts.metadata?.finishReason === "length") {
        return {
          attempt: failedAttempt(
            finished(),
            {
              category: "provider",
              code: "truncated_response",
              message: "the model stopped because of a token limit",
            },
            factsForRecord === undefined ? {} : { llm: factsForRecord },
          ),
        };
      }
      const parsed = parseReviewResponse(facts.content);
      if (!parsed.ok) {
        return {
          attempt: failedAttempt(
            finished(),
            {
              category: "provider",
              code: parsed.issues[0]?.code ?? "invalid_response",
              message: parsed.issues[0]?.message ?? "the response could not be read",
            },
            factsForRecord === undefined ? {} : { llm: factsForRecord },
          ),
        };
      }
      raw = parsed.verdicts;
    }

    const assessed = assess(definition, raw, manifest);
    context = finished();
    const record =
      request === undefined
        ? undefined
        : llmFacts(request, responseMetadata, responseMetadataInvalid);
    if (assessed.issues.length === 0) {
      return {
        attempt: completedAttempt(
          context,
          prepared,
          executionId,
          nextId("run"),
          assessed.verdicts,
          record,
        ),
        assessed,
      };
    }
    if (assessed.verdicts.length > 0) {
      return {
        attempt: partialAttempt(context, assessed.verdicts, assessed.issues, record),
        assessed,
      };
    }
    return {
      attempt: failedAttempt(
        context,
        {
          category: "execution",
          code: "no_valid_verdict",
          message: "the response contained no legal verdict for any criterion",
        },
        {
          ...(record === undefined ? {} : { llm: record }),
          issues: [...assessed.issues],
        },
      ),
      assessed,
    };
  } catch (error) {
    const finishedAt = clock.now().toISOString();
    if (error instanceof ReviewAbortError || activeSignal.aborted) {
      return { attempt: cancelledAttempt({ ...context, finishedAt }) };
    }
    const failure: ReviewFailure =
      method.kind === "llm"
        ? (() => {
            const provider = providerFailure(error);
            return {
              category: provider.category,
              code: provider.code,
              message: `model transport failed: ${provider.code}`,
              ...(provider.status === undefined ? {} : { httpStatus: provider.status }),
            };
          })()
        : checkerFailure(error);
    return {
      attempt: failedAttempt(
        { ...context, finishedAt },
        failure,
        method.kind === "llm" && request !== undefined
          ? { llm: { request, unknowns: ["response_metadata_missing"] } }
          : {},
      ),
    };
  } finally {
    activeSignal.removeEventListener("abort", abortAttempt);
  }
}
