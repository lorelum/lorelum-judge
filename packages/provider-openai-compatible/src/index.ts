import { identityOf } from "@lorelum/judge-protocol";
import {
  type ModelPort,
  ModelPortError,
  type ModelRequest,
  type ModelResponse,
  validateGenerationConfig,
} from "@lorelum/judge-runtime";

import { isRecord } from "./type-guards.js";

export const OPENAI_CHAT_COMPLETIONS_PROTOCOL = "openai.chat-completions/v1";
export const PROVIDER_LABEL = "openai-compatible";
export const PROVIDER_ADAPTER_VERSION = "1";

export type ProviderErrorCode =
  | "unsupported_config"
  | "invalid_endpoint"
  | "http_error"
  | "timeout"
  | "cancelled"
  | "network_error"
  | "invalid_response";

/**
 * A transport failure with a safe, whitelisted description. It never carries the
 * response body, credentials, headers, or the raw endpoint.
 */
export class ProviderTransportError extends ModelPortError {
  declare readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string, httpStatus?: number) {
    super(code, message, httpStatus);
    this.name = "ProviderTransportError";
  }
}

export interface EndpointDescription {
  /** Normalized URL without a trailing slash; credentials and query are refused. */
  readonly url: string;
  readonly identity: `sha256:${string}`;
}

export interface OpenAiCompatibleConfig {
  /** Base URL, for example `https://api.example.test/v1`. */
  readonly endpoint: string;
  /** Sent as a bearer token. Never part of endpoint identity or records. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  /** Test seam. Defaults to the runtime fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Validates the configured endpoint and computes its identity from the URL the
 * adapter actually uses. Only trailing slashes used to join `/chat/completions`
 * are removed; path, port, and scheme stay meaningful. User info, query strings,
 * fragments, and whitespace are rejected so credentials cannot enter identity.
 */
export function describeEndpoint(raw: string): EndpointDescription {
  if (typeof raw !== "string" || raw.length === 0 || /\s/.test(raw)) {
    throw new ProviderTransportError("invalid_endpoint", "endpoint must be a non-empty URL");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderTransportError("invalid_endpoint", "endpoint is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProviderTransportError("invalid_endpoint", "endpoint must use http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderTransportError("invalid_endpoint", "endpoint must not contain credentials");
  }
  if (url.search !== "") {
    throw new ProviderTransportError(
      "invalid_endpoint",
      "endpoint must not contain a query; pass credentials separately",
    );
  }
  if (url.hash !== "") {
    throw new ProviderTransportError("invalid_endpoint", "endpoint must not contain a fragment");
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  const identity = identityOf("lorelum.judge.endpoint/v1", normalized);
  if (!identity.ok) {
    throw new ProviderTransportError(
      "invalid_endpoint",
      `endpoint identity could not be computed: ${identity.error.reason}`,
    );
  }
  return { url: normalized, identity: identity.identity };
}

function unsupported(message: string): ProviderTransportError {
  return new ProviderTransportError("unsupported_config", message);
}

function checkedGeneration(config: ModelRequest["config"]): NonNullable<ModelRequest["config"]> {
  const checked = validateGenerationConfig(config);
  if (!checked.ok) {
    throw unsupported(checked.issues[0]?.message ?? "invalid generation configuration");
  }
  return checked.value;
}

function requestBody(
  request: ModelRequest,
  config: NonNullable<ModelRequest["config"]>,
): Record<string, unknown> {
  if (request.tools.length > 0) {
    throw unsupported("tool calling is not supported by the text provider");
  }
  const body: Record<string, unknown> = {
    model: config.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    stream: false,
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.topP !== undefined) body.top_p = config.topP;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
  if (config.seed !== undefined) body.seed = config.seed;
  return body;
}

interface ResponseFacts {
  readonly content: string;
  readonly metadata: NonNullable<Extract<ModelResponse, { kind: "message" }>["metadata"]>;
}

function readResponse(payload: unknown, status: number): ResponseFacts {
  if (!isRecord(payload)) {
    throw new ProviderTransportError("invalid_response", "response is not a JSON object");
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderTransportError("invalid_response", "response has no choices");
  }
  const first: unknown = choices[0];
  if (!isRecord(first)) {
    throw new ProviderTransportError("invalid_response", "the first choice is not an object");
  }
  const message = first.message;
  if (!isRecord(message) || typeof message.content !== "string" || message.content.length === 0) {
    throw new ProviderTransportError("invalid_response", "the response contains no text content");
  }

  const metadata: NonNullable<Extract<ModelResponse, { kind: "message" }>["metadata"]> = {
    provider: PROVIDER_LABEL,
    status: String(status),
    ...(typeof payload.id === "string" && payload.id.length > 0 ? { responseId: payload.id } : {}),
    ...(typeof payload.model === "string" && payload.model.length > 0
      ? { model: payload.model }
      : {}),
    ...(typeof first.finish_reason === "string" && first.finish_reason.length > 0
      ? { finishReason: first.finish_reason }
      : {}),
  };
  const usage = payload.usage;
  if (isRecord(usage)) {
    const promptTokens =
      typeof usage.prompt_tokens === "number" &&
      Number.isSafeInteger(usage.prompt_tokens) &&
      usage.prompt_tokens >= 0
        ? usage.prompt_tokens
        : undefined;
    const completionTokens =
      typeof usage.completion_tokens === "number" &&
      Number.isSafeInteger(usage.completion_tokens) &&
      usage.completion_tokens >= 0
        ? usage.completion_tokens
        : undefined;
    const totalTokens =
      typeof usage.total_tokens === "number" &&
      Number.isSafeInteger(usage.total_tokens) &&
      usage.total_tokens >= 0
        ? usage.total_tokens
        : undefined;
    if (promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined) {
      return {
        content: message.content,
        metadata: {
          ...metadata,
          usage: {
            ...(promptTokens === undefined ? {} : { promptTokens }),
            ...(completionTokens === undefined ? {} : { completionTokens }),
            ...(totalTokens === undefined ? {} : { totalTokens }),
          },
        },
      };
    }
  }
  return { content: message.content, metadata };
}

/**
 * Creates a non-streaming OpenAI Chat Completions text provider. It sends exactly
 * the requested model and explicit parameters, never retries, never switches
 * models, and never interprets the response beyond the transport envelope.
 */
export function createOpenAiCompatibleModel(config: OpenAiCompatibleConfig): ModelPort {
  const endpoint = describeEndpoint(config.endpoint);
  if (config.apiKey !== undefined && config.apiKey.length === 0) {
    throw new ProviderTransportError("unsupported_config", "apiKey must not be empty");
  }
  if (
    config.timeoutMs !== undefined &&
    (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)
  ) {
    throw unsupported("timeoutMs must be a positive safe integer");
  }
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ProviderTransportError("unsupported_config", "this runtime does not provide fetch");
  }
  const url = `${endpoint.url}/chat/completions`;

  return {
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const generation = checkedGeneration(request.config);
      const body = requestBody(request, generation);
      if (request.signal.aborted) {
        throw new ProviderTransportError("cancelled", "the request was cancelled");
      }

      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      const timer =
        config.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, config.timeoutMs);

      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json",
        };
        if (config.apiKey !== undefined) {
          headers.authorization = `Bearer ${config.apiKey}`;
        }
        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch {
          if (timedOut) {
            throw new ProviderTransportError("timeout", "the model request timed out");
          }
          if (request.signal.aborted) {
            throw new ProviderTransportError("cancelled", "the request was cancelled");
          }
          throw new ProviderTransportError(
            "network_error",
            "the model endpoint could not be reached",
          );
        }

        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderTransportError(
            "http_error",
            `the model endpoint returned HTTP ${response.status}`,
            response.status,
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (timedOut) {
            throw new ProviderTransportError("timeout", "the model request timed out");
          }
          if (request.signal.aborted) {
            throw new ProviderTransportError("cancelled", "the request was cancelled");
          }
          throw new ProviderTransportError(
            "invalid_response",
            "the model endpoint did not return JSON",
            response.status,
          );
        }
        const facts = readResponse(payload, response.status);
        return { kind: "message", content: facts.content, metadata: facts.metadata };
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
      }
    },
  };
}
