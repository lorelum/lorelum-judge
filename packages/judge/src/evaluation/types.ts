import type { CodeEvaluationReport, CodeTarget } from "@lorelum/judge-protocol";
import type { ReviewMethodInput, ReviewPorts } from "../review/types.js";
import type { SourceOptions } from "../sources/types.js";

/** Ordinary material and intent. Authentication belongs to ports, never this record. */
export interface EvaluateCodeInput {
  readonly target: CodeTarget | string;
  readonly request?: string;
  readonly requirements?: readonly (string | { readonly text: string; readonly source?: string })[];
  readonly context?: readonly (CodeTarget | string)[];
  readonly requirementSources?: readonly (CodeTarget | string)[];
  readonly opinions?: readonly {
    readonly id: string;
    readonly text: string;
    readonly source?: string;
  }[];
  readonly previousReport?: CodeEvaluationReport;
  readonly id?: string;
}

export interface EvaluationLimits {
  readonly maxContextRounds?: number;
  readonly maxRequestsPerRound?: number;
  readonly evidenceBudget?: number;
}

export interface EvaluationPorts extends ReviewPorts {
  readonly method: Extract<ReviewMethodInput, { readonly kind: "llm" }>;
  readonly sources?: SourceOptions;
  /** Explicit permission to disclose source-reader content to the configured model. */
  readonly allowModelDisclosure?: boolean;
  readonly limits?: EvaluationLimits;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type EvaluateCodeResult =
  | { readonly ok: true; readonly value: CodeEvaluationReport; readonly text: string }
  | {
      readonly ok: false;
      readonly issues: readonly {
        readonly path: string;
        readonly code: string;
        readonly message: string;
      }[];
    };
