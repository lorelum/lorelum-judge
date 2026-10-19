import type { ModelResponse, ModelResponseMetadata } from "@lorelum/judge-runtime";
import { isModelPortError } from "@lorelum/judge-runtime";

import type { ReviewFailure } from "./types.js";

interface ResponseFacts {
  readonly content: string;
  readonly metadata: ModelResponseMetadata | undefined;
  readonly invalidMetadata: boolean;
}

export class ReviewAbortError extends Error {
  constructor() {
    super("review cancelled");
    this.name = "ReviewAbortError";
  }
}

export class ReviewTimeoutError extends Error {
  constructor() {
    super("review attempt timed out");
    this.name = "ReviewTimeoutError";
  }
}

function nonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
  );
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function safeFailureMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "the checker failed";
  return trimmed.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

export function readCheckerOutput(raw: unknown): readonly unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null && "verdicts" in raw) {
    const verdicts = (raw as { readonly verdicts?: unknown }).verdicts;
    if (Array.isArray(verdicts)) return verdicts;
  }
  return undefined;
}

export function providerFailure(error: unknown): {
  readonly code: string;
  readonly category: ReviewFailure["category"];
  readonly status?: number;
} {
  if (error instanceof ReviewTimeoutError) {
    return { code: "timeout", category: "provider" };
  }
  if (isModelPortError(error)) {
    return {
      code: error.code,
      category: error.code === "cancelled" ? "execution" : "provider",
      ...(error.httpStatus === undefined ? {} : { status: error.httpStatus }),
    };
  }
  return { code: "provider_error", category: "provider" };
}

export function withAttemptBoundary<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
  abortOnTimeout?: () => void,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ReviewAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = (): void => {
      finish(() => reject(new ReviewAbortError()));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            finish(() => reject(new ReviewTimeoutError()));
            abortOnTimeout?.();
          }, timeoutMs);
    promise.then(
      (value) => {
        finish(() => resolve(value));
      },
      (error: unknown) => {
        finish(() => reject(error));
      },
    );
  });
}

export function responseFacts(response: ModelResponse): ResponseFacts | undefined {
  if (response.kind !== "message") return undefined;
  const metadata = response.metadata;
  if (metadata === undefined) {
    return { content: response.content, metadata: undefined, invalidMetadata: false };
  }
  let invalidMetadata = false;
  const provider = nonEmptyString(metadata.provider) ? metadata.provider : undefined;
  if (metadata.provider !== undefined && provider === undefined) invalidMetadata = true;
  const model = nonEmptyString(metadata.model) ? metadata.model : undefined;
  if (metadata.model !== undefined && model === undefined) invalidMetadata = true;
  const responseId = nonEmptyString(metadata.responseId) ? metadata.responseId : undefined;
  if (metadata.responseId !== undefined && responseId === undefined) invalidMetadata = true;
  const finishReason = nonEmptyString(metadata.finishReason) ? metadata.finishReason : undefined;
  if (metadata.finishReason !== undefined && finishReason === undefined) invalidMetadata = true;
  const status = nonEmptyString(metadata.status) ? metadata.status : undefined;
  if (metadata.status !== undefined && status === undefined) invalidMetadata = true;

  let usage: ModelResponseMetadata["usage"];
  if (metadata.usage !== undefined) {
    const promptTokens = tokenCount(metadata.usage.promptTokens);
    const completionTokens = tokenCount(metadata.usage.completionTokens);
    const totalTokens = tokenCount(metadata.usage.totalTokens);
    if (
      (metadata.usage.promptTokens !== undefined && promptTokens === undefined) ||
      (metadata.usage.completionTokens !== undefined && completionTokens === undefined) ||
      (metadata.usage.totalTokens !== undefined && totalTokens === undefined)
    ) {
      invalidMetadata = true;
    }
    if (promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined) {
      usage = {
        ...(promptTokens === undefined ? {} : { promptTokens }),
        ...(completionTokens === undefined ? {} : { completionTokens }),
        ...(totalTokens === undefined ? {} : { totalTokens }),
      };
    }
  }

  return {
    content: response.content,
    invalidMetadata,
    metadata: {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(responseId === undefined ? {} : { responseId }),
      ...(finishReason === undefined ? {} : { finishReason }),
      ...(status === undefined ? {} : { status }),
      ...(usage === undefined ? {} : { usage }),
    },
  };
}

export function unknownFacts(
  metadata: ModelResponseMetadata | undefined,
  invalidMetadata = false,
): string[] {
  if (metadata === undefined) return ["response_metadata_missing"];
  return [
    ...(metadata.model === undefined ? ["response_model_unknown"] : []),
    ...(metadata.finishReason === undefined ? ["finish_reason_unknown"] : []),
    ...(metadata.usage === undefined ? ["usage_unknown"] : []),
    ...(invalidMetadata ? ["response_metadata_invalid"] : []),
  ];
}
