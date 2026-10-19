import type {
  EvidenceBundle,
  InstrumentProfileV2,
  MeasurementDefinitionV2,
  ReviewAttempt,
  ReviewExecution,
  ReviewIssue,
  ValidationIssue,
  ValidationResult,
  Verdict,
} from "@lorelum/judge-protocol";
import type { ModelGenerationConfig, ModelPort, RuntimeMessage } from "@lorelum/judge-runtime";

import type { EvidenceMaterial } from "../evidence.js";

export const REVIEW_EXECUTION_VERSION = "lorelum.judge.review-execution/v1";
export const REVIEW_INPUT_SCHEMA = "lorelum.judge.review-input/v1";

export interface ProgramCheckerInput {
  readonly definition: MeasurementDefinitionV2;
  readonly evidence: readonly EvidenceMaterial[];
  readonly signal: AbortSignal;
}

export interface ProgramCheckerOutput {
  readonly verdicts: readonly unknown[];
}

export type ProgramChecker = (
  input: ProgramCheckerInput,
) => ProgramCheckerOutput | Promise<ProgramCheckerOutput>;

export type ReviewMethodInput =
  | {
      readonly kind: "program";
      readonly checker: {
        readonly id: string;
        readonly version?: string;
        readonly contentIdentity?: string;
      };
    }
  | {
      readonly kind: "llm";
      readonly provider: {
        readonly protocol: string;
        readonly adapterVersion: string;
      };
      readonly endpointIdentity: string;
      readonly model: {
        readonly provider: string;
        readonly name: string;
        readonly version?: string;
      };
      readonly decoding?: {
        readonly temperature?: number;
        readonly topP?: number;
        readonly maxTokens?: number;
        readonly seed?: number;
      };
    };

export interface ExecuteReviewInput {
  readonly id?: string;
  readonly definition: unknown;
  readonly evidence: readonly EvidenceMaterial[];
  readonly method: ReviewMethodInput;
  /** Explicit only. Ordinary review runs once. */
  readonly repetitions?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ReviewPorts {
  readonly model?: ModelPort;
  readonly checker?: ProgramChecker;
  readonly clock?: { now(): Date };
  readonly nextId?: (prefix: string) => string;
}

export interface ReviewFinding {
  readonly criterionId: string;
  readonly role: "decisive" | "advisory";
  readonly required: boolean;
  readonly status: "assessed" | "missing" | "invalid";
  readonly verdict?: Verdict;
  readonly disagreement: boolean;
  readonly issues: readonly ReviewIssue[];
}

export type ReviewCompleteness = "complete" | "partial" | "failed" | "cancelled" | "not_started";

export interface ExecuteReviewValue {
  readonly definition: MeasurementDefinitionV2;
  readonly instrument: InstrumentProfileV2;
  readonly execution: ReviewExecution;
  readonly findings: readonly ReviewFinding[];
  readonly completeness: ReviewCompleteness;
}

export type ExecuteReviewResult =
  | { readonly ok: true; readonly value: ExecuteReviewValue }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface PreparedReview {
  readonly definition: MeasurementDefinitionV2;
  readonly instrument: InstrumentProfileV2;
  readonly manifest: EvidenceBundle;
  readonly materials: readonly EvidenceMaterial[];
  readonly method: ReviewMethodInput;
  readonly repetitions: number;
  readonly timeoutMs: number | undefined;
  readonly promptIdentity: string | undefined;
  readonly messages: readonly RuntimeMessage[] | undefined;
  readonly renderIdentity: string | undefined;
  readonly inputIdentity: string;
  readonly definitionIdentity: string;
  readonly instrumentIdentity: string;
  readonly evidenceIdentity: string;
  readonly id?: string;
}

export type PrepareReviewResult = ValidationResult<PreparedReview>;

export type ReviewFailure = NonNullable<ReviewAttempt["failure"]>;
export type LlmRequestFacts = NonNullable<ReviewAttempt["llm"]>["request"];
export type LlmFacts = NonNullable<ReviewAttempt["llm"]>;

export type GenerationConfig = ModelGenerationConfig;
