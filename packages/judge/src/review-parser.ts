import { isRecord } from "./type-guards.js";

export const REVIEW_RESULT_PROTOCOL_VERSION = "lorelum.judge.review-result/v1";
export const REVIEW_PARSER_VERSION = "lorelum.judge.review-parser/v1";

export interface ReviewParserIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ReviewParseResult =
  | { readonly ok: true; readonly verdicts: readonly unknown[] }
  | { readonly ok: false; readonly issues: readonly ReviewParserIssue[] };

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const CODE_BLOCK = /^```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```$/;

function parserFailure(
  path: string,
  code: string,
  message: string,
): { readonly ok: false; readonly issues: readonly ReviewParserIssue[] } {
  return { ok: false, issues: [{ path, code, message }] };
}

class JsonReader {
  readonly text: string;
  index = 0;

  constructor(text: string) {
    this.text = text;
  }

  fail(message: string): never {
    throw new JsonReadError(this.index, message);
  }

  skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index] ?? "")) {
      this.index += 1;
    }
  }

  parseValue(path: string): unknown {
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === "{") return this.parseObject(path);
    if (char === "[") return this.parseArray(path);
    if (char === '"') return this.parseString();
    if (char === "t" && this.text.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (char === "f" && this.text.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (char === "n" && this.text.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  parseObject(path: string): Record<string, unknown> {
    this.index += 1;
    const value: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("object key must be a string");
      const keyPath = `${path}.key`;
      const key = this.parseString(keyPath);
      if (keys.has(key)) {
        throw new JsonReadError(this.index, `duplicate object key "${key}"`);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("expected ':' after object key");
      this.index += 1;
      const entry = this.parseValue(`${path}.${key}`);
      Object.defineProperty(value, key, {
        value: entry,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.skipWhitespace();
      const next = this.text[this.index];
      if (next === ",") {
        this.index += 1;
        continue;
      }
      if (next === "}") {
        this.index += 1;
        return value;
      }
      this.fail("expected ',' or '}' in object");
    }
  }

  parseArray(path: string): unknown[] {
    this.index += 1;
    const value: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (true) {
      value.push(this.parseValue(`${path}[${value.length}]`));
      this.skipWhitespace();
      const next = this.text[this.index];
      if (next === ",") {
        this.index += 1;
        continue;
      }
      if (next === "]") {
        this.index += 1;
        return value;
      }
      this.fail("expected ',' or ']' in array");
    }
  }

  parseString(path = "$"): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char === '"') {
        this.index += 1;
        const token = this.text.slice(start, this.index);
        try {
          return JSON.parse(token) as string;
        } catch {
          throw new JsonReadError(start, "invalid string escape");
        }
      }
      if (char === "\\") {
        this.index += 2;
        continue;
      }
      if (char !== undefined && char.charCodeAt(0) < 0x20) {
        throw new JsonReadError(this.index, "unescaped control character in string");
      }
      this.index += 1;
    }
    throw new JsonReadError(start, `unterminated string at ${path}`);
  }

  parseNumber(): number {
    const match = NUMBER.exec(this.text.slice(this.index));
    if (match === null) {
      this.fail("expected a JSON value");
    }
    const token = match[0];
    this.index += token.length;
    return Number(token);
  }
}

class JsonReadError extends Error {
  readonly position: number;

  constructor(position: number, message: string) {
    super(message);
    this.name = "JsonReadError";
    this.position = position;
  }
}

function readJsonObject(text: string): JsonObjectParseResult {
  const reader = new JsonReader(text);
  let value: unknown;
  try {
    value = reader.parseValue("$");
    reader.skipWhitespace();
    if (reader.index !== text.length) {
      return parserFailure("$", "malformed_json", "unexpected text after the JSON value");
    }
  } catch (error) {
    if (error instanceof JsonReadError) {
      return parserFailure(
        "$",
        error.message.startsWith("duplicate object key") ? "duplicate_key" : "malformed_json",
        error.message,
      );
    }
    return parserFailure("$", "malformed_json", "the response could not be parsed as JSON");
  }
  if (!isRecord(value)) {
    return parserFailure("$", "invalid_shape", "the response must be one JSON object");
  }
  return { ok: true, value };
}

export type JsonObjectParseResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly issues: readonly ReviewParserIssue[] };

export function parseReviewResponse(input: unknown): ReviewParseResult {
  const parsed = parseJsonObject(input);
  if (!parsed.ok) return parsed;
  for (const key of Object.keys(parsed.value)) {
    if (key !== "verdicts") return parserFailure("$", "unknown_field", `unexpected field "${key}"`);
  }
  if (!Array.isArray(parsed.value.verdicts))
    return parserFailure("$.verdicts", "invalid_shape", "verdicts must be an array");
  return { ok: true, verdicts: parsed.value.verdicts };
}

/**
 * Reads the default review response envelope. Accepts surrounding whitespace,
 * bare JSON, or exactly one complete `json` or unlabelled Markdown code block.
 * Ambiguous wrappers, duplicate keys, and malformed JSON are refused; nothing is
 * repaired and no second model call is made.
 */
export function parseJsonObject(input: unknown): JsonObjectParseResult {
  if (typeof input !== "string") {
    return parserFailure("$", "invalid_input", "the response must be text");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return parserFailure("$", "empty_response", "the response is empty");
  }
  if (!trimmed.startsWith("```")) {
    return readJsonObject(trimmed);
  }
  const block = CODE_BLOCK.exec(trimmed);
  if (block === null) {
    return parserFailure(
      "$",
      "invalid_wrapper",
      "expected exactly one complete json or unlabelled code block and no other text",
    );
  }
  return readJsonObject((block[1] ?? "").trim());
}
