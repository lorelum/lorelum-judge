import { expect, test } from "bun:test";

import type { EvidenceStatus, ValidationResult } from "../src/index.js";

test("retains the evidence status and validation result public types", () => {
  const status: EvidenceStatus = "present";
  const result: ValidationResult<number> = { ok: true, value: 1 };
  expect(status).toBe("present");
  expect(result.ok).toBe(true);
});
