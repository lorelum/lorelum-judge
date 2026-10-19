import {
  type InstrumentProfileV2,
  SHA256_IDENTITY,
  type ValidationResult,
} from "@lorelum/judge-protocol";
import type { ModelGenerationConfig } from "@lorelum/judge-runtime";
import { validateGenerationConfig } from "@lorelum/judge-runtime";
import { PROMPT_RENDER_VERSION } from "../prompt-compiler.js";
import { REVIEW_PARSER_VERSION, REVIEW_RESULT_PROTOCOL_VERSION } from "../review-parser.js";
import { REVIEW_COMPILER_VERSION } from "../review-prompt.js";
import { isRecord } from "../type-guards.js";
import { type LlmRequestFacts, REVIEW_EXECUTION_VERSION, type ReviewMethodInput } from "./types.js";
import { validation } from "./validation.js";

export function validateMethod(raw: unknown): ValidationResult<ReviewMethodInput> {
  if (!isRecord(raw)) {
    return { ok: false, issues: [validation("$.method", "method must be an object")] };
  }
  if (raw.kind === "program") {
    if (
      !isRecord(raw.checker) ||
      typeof raw.checker.id !== "string" ||
      raw.checker.id.length === 0
    ) {
      return { ok: false, issues: [validation("$.method.checker.id", "checker id is required")] };
    }
    const version =
      typeof raw.checker.version === "string" && raw.checker.version.length > 0
        ? raw.checker.version
        : undefined;
    const contentIdentity =
      typeof raw.checker.contentIdentity === "string" ? raw.checker.contentIdentity : undefined;
    if (version === undefined && contentIdentity === undefined) {
      return {
        ok: false,
        issues: [validation("$.method.checker", "name the checker version or content identity")],
      };
    }
    if (contentIdentity !== undefined && !SHA256_IDENTITY.test(contentIdentity)) {
      return {
        ok: false,
        issues: [validation("$.method.checker.contentIdentity", "must be a sha256 identity")],
      };
    }
    return {
      ok: true,
      value: {
        kind: "program",
        checker: {
          id: raw.checker.id,
          ...(version === undefined ? {} : { version }),
          ...(contentIdentity === undefined ? {} : { contentIdentity }),
        },
      },
    };
  }
  if (raw.kind === "llm") {
    if (
      !isRecord(raw.provider) ||
      typeof raw.provider.protocol !== "string" ||
      raw.provider.protocol.length === 0 ||
      typeof raw.provider.adapterVersion !== "string" ||
      raw.provider.adapterVersion.length === 0
    ) {
      return {
        ok: false,
        issues: [validation("$.method.provider", "protocol and adapterVersion are required")],
      };
    }
    if (typeof raw.endpointIdentity !== "string" || !SHA256_IDENTITY.test(raw.endpointIdentity)) {
      return {
        ok: false,
        issues: [validation("$.method.endpointIdentity", "must be a sha256 identity")],
      };
    }
    if (
      !isRecord(raw.model) ||
      typeof raw.model.provider !== "string" ||
      raw.model.provider.length === 0 ||
      typeof raw.model.name !== "string" ||
      raw.model.name.length === 0
    ) {
      return {
        ok: false,
        issues: [validation("$.method.model", "model provider and name are required")],
      };
    }
    if (raw.decoding !== undefined && !isRecord(raw.decoding)) {
      return { ok: false, issues: [validation("$.method.decoding", "decoding must be an object")] };
    }
    if (isRecord(raw.decoding) && "model" in raw.decoding) {
      return {
        ok: false,
        issues: [validation("$.method.decoding.model", "decoding must not set the model")],
      };
    }
    const generation = validateGenerationConfig({
      ...(isRecord(raw.decoding) ? raw.decoding : {}),
      model: raw.model.name,
    });
    if (!generation.ok) {
      return {
        ok: false,
        issues: generation.issues.map((issue) => ({
          ...issue,
          path:
            issue.path === "$.config.model"
              ? "$.method.model.name"
              : `$.method.decoding${issue.path.slice("$.config".length)}`,
        })),
      };
    }
    const decoding = generation.value;
    return {
      ok: true,
      value: {
        kind: "llm",
        provider: {
          protocol: raw.provider.protocol,
          adapterVersion: raw.provider.adapterVersion,
        },
        endpointIdentity: raw.endpointIdentity,
        model: {
          provider: raw.model.provider,
          name: raw.model.name,
          ...(typeof raw.model.version === "string" && raw.model.version.length > 0
            ? { version: raw.model.version }
            : {}),
        },
        decoding: {
          ...(decoding.temperature === undefined ? {} : { temperature: decoding.temperature }),
          ...(decoding.topP === undefined ? {} : { topP: decoding.topP }),
          ...(decoding.maxTokens === undefined ? {} : { maxTokens: decoding.maxTokens }),
          ...(decoding.seed === undefined ? {} : { seed: decoding.seed }),
        },
      },
    };
  }
  return { ok: false, issues: [validation("$.method.kind", "method must be program or llm")] };
}

export function instrumentFor(
  method: ReviewMethodInput,
  repetitions: number,
  promptIdentity: string | undefined,
): InstrumentProfileV2 {
  if (method.kind === "program") {
    return {
      schema: "lorelum.judge.instrument-profile/v2",
      method: {
        kind: "program",
        checker: method.checker,
        implementationVersion: REVIEW_EXECUTION_VERSION,
        resultProtocolVersion: REVIEW_RESULT_PROTOCOL_VERSION,
        parserVersion: REVIEW_PARSER_VERSION,
        runtime: { name: "@lorelum/judge", version: "0.0.0" },
        repetitions,
      },
    };
  }
  if (promptIdentity === undefined) {
    throw new Error("an LLM instrument requires a compiled prompt identity");
  }
  return {
    schema: "lorelum.judge.instrument-profile/v2",
    method: {
      kind: "llm",
      provider: method.provider,
      endpointIdentity: method.endpointIdentity,
      model: method.model,
      decoding: method.decoding ?? {},
      promptIdentity,
      compilerVersion: REVIEW_COMPILER_VERSION,
      renderVersion: PROMPT_RENDER_VERSION,
      parserVersion: REVIEW_PARSER_VERSION,
      runtime: { name: "@lorelum/judge", version: "0.0.0" },
      repetitions,
    },
  };
}

export function llmRequestFacts(
  method: Extract<ReviewMethodInput, { kind: "llm" }>,
  promptIdentity: string | undefined,
  renderIdentity: string | undefined,
  timeoutMs: number | undefined,
): LlmRequestFacts {
  return {
    model: method.model.name,
    modelProvider: method.model.provider,
    endpointIdentity: method.endpointIdentity,
    parameters: method.decoding ?? {},
    ...(renderIdentity === undefined ? {} : { messagesIdentity: renderIdentity }),
    ...(promptIdentity === undefined ? {} : { promptIdentity }),
    ...(renderIdentity === undefined ? {} : { renderIdentity }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export function generationFor(
  method: Extract<ReviewMethodInput, { kind: "llm" }>,
): ModelGenerationConfig {
  const decoding = method.decoding ?? {};
  return {
    model: method.model.name,
    ...(decoding.temperature === undefined ? {} : { temperature: decoding.temperature }),
    ...(decoding.topP === undefined ? {} : { topP: decoding.topP }),
    ...(decoding.maxTokens === undefined ? {} : { maxTokens: decoding.maxTokens }),
    ...(decoding.seed === undefined ? {} : { seed: decoding.seed }),
  };
}
