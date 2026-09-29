import { describe, expect, test } from "bun:test";

import { validateBunVersionConsistency, validateRepository } from "../scripts/repository-baseline";

describe("repository baseline", () => {
  test("contains every required validation entry point", () => {
    expect(validateRepository()).toEqual([]);
  });

  test("requires the local package manager to match CI", () => {
    const workflow = `
steps:
  - uses: oven-sh/setup-bun@v2
    with:
      bun-version: 1.4.2
`;

    expect(validateBunVersionConsistency("bun@1.4.2", workflow)).toEqual([]);
    expect(validateBunVersionConsistency("bun@1.5.0", workflow)).toEqual([
      "package.json packageManager must match validate workflow: expected bun@1.4.2",
    ]);
  });
});
