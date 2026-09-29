export type ErrorCode =
  | "CANONICALIZATION_FAILED"
  | "INVALID_ARGUMENT"
  | "IDENTITY_MISMATCH"
  | "PROTOCOL_VALIDATION_FAILED";

export interface LorelumJudgeErrorOptions {
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class LorelumJudgeError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, options: LorelumJudgeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LorelumJudgeError";
    this.code = code;
    this.details = options.details ?? {};
  }
}
