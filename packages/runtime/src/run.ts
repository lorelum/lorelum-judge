import type { JsonValue } from "./json.js";
import type { RuntimeMessage } from "./model.js";

export type RuntimeStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

export type RuntimeFailureKind =
  | "environment_error"
  | "model_error"
  | "tool_error"
  | "protocol_error";

export interface RuntimeFailure {
  readonly kind: RuntimeFailureKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonValue;
}

export interface RuntimeStep {
  readonly index: number;
  readonly responseKind: "message" | "tool_calls" | "structured";
  readonly toolCallIds: readonly string[];
}

export interface RuntimeEventBase {
  readonly runId: string;
  readonly at: string;
  readonly stepIndex: number;
}

export type RuntimeEvent =
  | (RuntimeEventBase & {
      readonly type: "run_started";
    })
  | (RuntimeEventBase & {
      readonly type: "model_requested";
    })
  | (RuntimeEventBase & {
      readonly type: "model_responded";
      readonly responseKind: "message" | "tool_calls" | "structured";
    })
  | (RuntimeEventBase & {
      readonly type: "tool_started";
      readonly toolCallId: string;
      readonly toolName: string;
    })
  | (RuntimeEventBase & {
      readonly type: "tool_completed";
      readonly toolCallId: string;
      readonly toolName: string;
    })
  | (RuntimeEventBase & {
      readonly type: "step_completed";
    })
  | (RuntimeEventBase & {
      readonly type: "run_paused";
    })
  | (RuntimeEventBase & {
      readonly type: "run_completed";
    })
  | (RuntimeEventBase & {
      readonly type: "run_failed";
      readonly failure: RuntimeFailure;
    })
  | (RuntimeEventBase & {
      readonly type: "run_cancelled";
    });

export interface RuntimeRun {
  readonly schema: "lorelum.runtime.run/v1";
  readonly runId: string;
  readonly status: RuntimeStatus;
  readonly stepIndex: number;
  readonly maxSteps: number;
  readonly messages: readonly RuntimeMessage[];
  readonly steps: readonly RuntimeStep[];
  readonly events: readonly RuntimeEvent[];
  readonly output?: JsonValue;
  readonly failure?: RuntimeFailure;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeRequest {
  readonly runId: string;
  readonly messages: readonly RuntimeMessage[];
  readonly maxSteps?: number;
  readonly signal: AbortSignal;
}

export interface ResumeRequest {
  readonly runId: string;
  readonly maxSteps?: number;
  readonly signal: AbortSignal;
}

export type ResumeResult =
  | {
      readonly ok: true;
      readonly run: RuntimeRun;
    }
  | {
      readonly ok: false;
      readonly failure: RuntimeFailure;
    };
