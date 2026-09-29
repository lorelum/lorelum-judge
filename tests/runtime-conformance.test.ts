import { describe, expect, test } from "bun:test";

import { referenceRuntime } from "../packages/runtime/src";
import { runRuntimeConformance } from "../packages/testing/src";

describe("reference runtime conformance", () => {
  test("passes the shared runtime contract", async () => {
    const report = await runRuntimeConformance(referenceRuntime);
    expect(report.cases.filter((entry) => !entry.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
