import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../src/index.js";
import { canonicalForm, identityOf } from "../src/index.js";

function text(value: JsonValue): string {
  const result = canonicalForm(value);
  if (!result.ok) {
    throw new Error(`unexpected canonical failure at ${result.error.path}`);
  }
  return result.text;
}

function identity(schema: string, value: JsonValue): string {
  const result = identityOf(schema, value);
  if (!result.ok) {
    throw new Error(`unexpected identity failure at ${result.error.path}`);
  }
  return result.identity;
}

describe("identityOf", () => {
  test("has the form sha256:<64 lowercase hex>", () => {
    expect(identity("test/v1", { a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("does not depend on object key order", () => {
    expect(identity("test/v1", { a: 1, b: { c: 2, d: 3 } })).toBe(
      identity("test/v1", { b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  test("changes when any field value changes", () => {
    const base = identity("test/v1", { a: 1, b: "x" });
    expect(identity("test/v1", { a: 2, b: "x" })).not.toBe(base);
    expect(identity("test/v1", { a: 1, b: "y" })).not.toBe(base);
  });

  test("changes when an array element or array position changes", () => {
    const base = identity("test/v1", { items: [1, 2, 3] });
    expect(identity("test/v1", { items: [1, 2, 4] })).not.toBe(base);
    expect(identity("test/v1", { items: [3, 2, 1] })).not.toBe(base);
  });

  test("distinguishes null, absence, and empty values", () => {
    const ids = new Set([
      identity("test/v1", {}),
      identity("test/v1", { a: null }),
      identity("test/v1", { a: [] }),
      identity("test/v1", { a: {} }),
      identity("test/v1", { a: "" }),
    ]);
    expect(ids.size).toBe(5);
  });

  test("keeps record types apart under the same content", () => {
    expect(identity("rubric/v1", { a: 1 })).not.toBe(identity("verdict/v1", { a: 1 }));
  });

  test("keeps schema versions apart under the same content", () => {
    expect(identity("rubric/v1", { a: 1 })).not.toBe(identity("rubric/v2", { a: 1 }));
  });
});

describe("rejected input", () => {
  test("undefined field is rejected with its path and never matches the field-less value", () => {
    const result = identityOf("test/v1", { a: 1, b: undefined } as unknown as JsonValue);
    expect(result).toEqual({ ok: false, error: { path: "$.value.b", reason: "undefined" } });
    expect(identity("test/v1", { a: 1 })).toMatch(/^sha256:/);
  });

  test("undefined inside an array is rejected with its index", () => {
    const result = identityOf("test/v1", { a: [1, undefined] } as unknown as JsonValue);
    expect(result).toEqual({ ok: false, error: { path: "$.value.a[1]", reason: "undefined" } });
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("%s is rejected", (_name, bad) => {
    expect(identityOf("test/v1", { a: bad })).toEqual({
      ok: false,
      error: { path: "$.value.a", reason: "not_finite" },
    });
  });

  test("bigint is rejected", () => {
    const result = identityOf("test/v1", { a: 1n } as unknown as JsonValue);
    expect(result).toEqual({ ok: false, error: { path: "$.value.a", reason: "bigint" } });
  });

  test("returns a result instead of throwing for invalid input", () => {
    expect(() => identityOf("test/v1", Symbol("x") as unknown as JsonValue)).not.toThrow();
    expect(identityOf("test/v1", (() => 1) as unknown as JsonValue).ok).toBe(false);
  });
});

describe("RFC 8785 vectors inside the supported subset", () => {
  test("primitive serialization sample (Section 3.2.2 and 3.2.4)", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals":[null,true,false]}',
    ) as JsonValue;
    const expectedHex =
      "7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c226e756d62657273223a" +
      "5b3333333333333333332e333333333333332c31652b33302c342e352c302e3030322c31652d32375d" +
      "2c22737472696e67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d";
    expect(Buffer.from(text(input), "utf8").toString("hex")).toBe(expectedHex);
  });

  test("property names sort by UTF-16 code units (Section 3.2.3)", () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
        '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
        '"\\u00f6":"Latin Small Letter O With Diaeresis"}',
    ) as Record<string, string>;
    const canonical = text(input);
    const sorted = [
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ];
    const positions = sorted.map((value) => canonical.indexOf(`"${value}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test.each([
    [0, "0"],
    [-0, "0"],
    [5e-324, "5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    [9007199254740992, "9007199254740992"],
    [295147905179352830000, "295147905179352830000"],
    [9.999999999999997e22, "9.999999999999997e+22"],
    [1e23, "1e+23"],
    [1e21, "1e+21"],
    [0.000001, "0.000001"],
    [333333333.33333325, "333333333.33333325"],
    [-0.0000033333333333333333, "-0.0000033333333333333333"],
  ])("number %p serializes as %s (Appendix B)", (input, expected) => {
    expect(text([input])).toBe(`[${expected}]`);
  });
});
