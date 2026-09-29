import { describe, expect, test } from "bun:test";

import { validateRepository } from "../scripts/repository-baseline";

describe("repository baseline", () => {
  test("contains every required validation entry point", () => {
    expect(validateRepository()).toEqual([]);
  });
});
