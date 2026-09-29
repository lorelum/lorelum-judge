import type { JsonValue } from "./json";
import type { RuntimeFailure, RuntimeFailureKind } from "./run";

export interface RuntimeFailureErrorOptions {
  readonly retryable?: boolean;
  readonly details?: JsonValue;
}

export class RuntimeFailureError extends Error {
  readonly kind: RuntimeFailureKind;
  readonly retryable: boolean;
  readonly details?: JsonValue;

  constructor(kind: RuntimeFailureKind, message: string, options: RuntimeFailureErrorOptions = {}) {
    super(message);
    this.name = "RuntimeFailureError";
    this.kind = kind;
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function toRuntimeFailure(error: unknown, fallbackKind: RuntimeFailureKind): RuntimeFailure {
  if (error instanceof RuntimeFailureError) {
    return {
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  return {
    kind: fallbackKind,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
