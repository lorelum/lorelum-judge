import canonicalize from "canonicalize";

import { LorelumJudgeError } from "./errors";

export function canonicalJson(value: unknown): string {
  let encoded: string | undefined;

  try {
    encoded = canonicalize(value);
  } catch (cause) {
    throw new LorelumJudgeError(
      "CANONICALIZATION_FAILED",
      "The value cannot be represented as canonical JSON.",
      { cause },
    );
  }

  if (encoded === undefined) {
    throw new LorelumJudgeError(
      "CANONICALIZATION_FAILED",
      "The top-level value cannot be represented as canonical JSON.",
    );
  }

  return encoded;
}
