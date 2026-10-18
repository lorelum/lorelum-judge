import { type CriterionKind, decisiveVerdicts, type VerdictValue } from "./criterion.js";

export interface VerdictAggregation {
  readonly prediction?: VerdictValue;
  readonly disagreement: boolean;
  readonly abstained: boolean;
}

/**
 * Majority vote with an agreement threshold. `denominator` is the planned
 * repetition count, not the number of surviving votes: padded execution
 * failures shrink the ratio instead of disappearing. A non-positive
 * denominator never yields a prediction; callers validate repetition counts
 * against the instrument schema before aggregating.
 */
export function aggregateVerdicts(
  kind: CriterionKind,
  verdicts: readonly VerdictValue[],
  denominator: number,
  minimumAgreement: number,
): VerdictAggregation {
  const counts = new Map<VerdictValue, number>();
  for (const verdict of verdicts) counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  const highest = Math.max(0, ...counts.values());
  const leaders = [...counts].filter(([, count]) => count === highest);
  const leader = leaders.length === 1 ? leaders[0]?.[0] : undefined;
  const prediction =
    leader !== undefined &&
    denominator > 0 &&
    decisiveVerdicts[kind].includes(leader) &&
    highest / denominator >= minimumAgreement
      ? leader
      : undefined;

  return {
    ...(prediction === undefined ? {} : { prediction }),
    disagreement: new Set(verdicts).size > 1,
    abstained:
      verdicts.length > 0 &&
      verdicts.every((value) => value === "unknown" || value === "insufficient"),
  };
}

export type ConfidenceLevel = 0.9 | 0.95 | 0.99;

/**
 * Wilson score interval for `numerator` successes in `denominator` trials.
 * Throws `RangeError` unless `0 <= numerator <= denominator` and
 * `denominator > 0`. Callers outside a validator MUST pre-check counts or
 * catch; validators route failures through structured issues instead.
 */
export function wilsonInterval(
  numerator: number,
  denominator: number,
  confidenceLevel: ConfidenceLevel,
): readonly [number, number] {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    numerator < 0 ||
    numerator > denominator
  ) {
    throw new RangeError(
      "Wilson interval requires 0 <= numerator <= denominator and denominator > 0",
    );
  }
  const z =
    confidenceLevel === 0.9
      ? 1.6448536269514722
      : confidenceLevel === 0.95
        ? 1.959963984540054
        : 2.5758293035489004;
  const estimate = numerator / denominator;
  const z2 = z * z;
  const adjustedDenominator = 1 + z2 / denominator;
  const center = (estimate + z2 / (2 * denominator)) / adjustedDenominator;
  const radius =
    (z * Math.sqrt((estimate * (1 - estimate)) / denominator + z2 / (4 * denominator ** 2))) /
    adjustedDenominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
