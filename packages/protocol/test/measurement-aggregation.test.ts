import { describe, expect, test } from "bun:test";
import { aggregateVerdicts, wilsonInterval } from "../src/index.js";

describe("shared measurement statistics", () => {
  test("uses one majority and agreement rule for every caller", () => {
    expect(aggregateVerdicts("contract", ["met", "met", "unmet"], 3, 2 / 3)).toEqual({
      prediction: "met",
      disagreement: true,
      abstained: false,
    });
    expect(aggregateVerdicts("contract", ["met", "unmet", "unknown"], 3, 2 / 3)).toEqual({
      disagreement: true,
      abstained: false,
    });
  });

  test("keeps all-abstention runs distinct from disagreement", () => {
    expect(aggregateVerdicts("quality", ["unknown", "insufficient", "unknown"], 3, 2 / 3)).toEqual({
      disagreement: true,
      abstained: true,
    });
  });

  test("calculates Wilson bounds at extremes and rejects invalid counts", () => {
    const [zeroLower, zeroUpper] = wilsonInterval(0, 20, 0.95);
    expect(zeroLower).toBe(0);
    expect(zeroUpper).toBeCloseTo(0.16112515805281938);
    const [lower, upper] = wilsonInterval(20, 20, 0.95);
    expect(lower).toBeCloseTo(0.8388748419471806);
    expect(upper).toBe(1);
    expect(() => wilsonInterval(2, 1, 0.95)).toThrow(RangeError);
  });
});
