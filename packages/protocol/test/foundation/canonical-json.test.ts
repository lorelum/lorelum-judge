import { describe, expect, test } from "bun:test";

import { canonicalHash, canonicalJson, LorelumJudgeError } from "../../src";

describe("canonical JSON", () => {
  test("orders object keys deterministically", () => {
    const left = { b: 2, a: 1 };
    const right = { a: 1, b: 2 };

    expect(canonicalJson(left)).toBe('{"a":1,"b":2}');
    expect(canonicalJson(right)).toBe(canonicalJson(left));
  });

  test("preserves array order", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  test("rejects values without a canonical top-level representation", () => {
    expect(() => canonicalJson(undefined)).toThrow(LorelumJudgeError);
  });
});

describe("canonical hashes", () => {
  test("are stable across object key order", () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
  });

  test("change when identity-bearing content changes", () => {
    expect(canonicalHash({ value: 1 })).not.toBe(canonicalHash({ value: 2 }));
  });
});
