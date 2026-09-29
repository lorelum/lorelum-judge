import { describe, expect, test } from "bun:test";

import {
  checkWorkspace,
  isAllowedDependency,
  isAllowedTestDependency,
} from "../scripts/check-layers";

describe("workspace package boundaries", () => {
  test("current workspace graph is valid", () => {
    expect(checkWorkspace()).toEqual([]);
  });

  test("declares the core dependency direction", () => {
    expect(isAllowedDependency("@lorelum/judge-protocol", "@lorelum/judge-runtime")).toBe(false);
    expect(isAllowedDependency("@lorelum/judge-runtime", "@lorelum/judge-protocol")).toBe(true);
    expect(isAllowedDependency("@lorelum/judge", "@lorelum/judge-runtime")).toBe(true);
    expect(isAllowedDependency("@lorelum/judge-workflow", "@lorelum/judge")).toBe(true);
  });

  test("keeps production packages independent from the test kit", () => {
    expect(isAllowedDependency("@lorelum/judge", "@lorelum/judge-testing")).toBe(false);
    expect(isAllowedDependency("@lorelum/judge-cli", "@lorelum/judge-testing")).toBe(false);
  });

  test("reserves runtime and provider integration boundaries", () => {
    expect(isAllowedDependency("@lorelum/runtime-openai", "@lorelum/judge-runtime")).toBe(true);
    expect(isAllowedDependency("@lorelum/provider-openai", "@lorelum/judge-runtime")).toBe(true);
    expect(isAllowedDependency("@lorelum/runtime-openai", "@lorelum/judge-workflow")).toBe(false);
    expect(isAllowedDependency("@lorelum/runtime-openai", "@lorelum/judge-testing")).toBe(false);
    expect(isAllowedTestDependency("@lorelum/runtime-openai", "@lorelum/judge-testing")).toBe(true);
    expect(isAllowedTestDependency("@lorelum/provider-openai", "@lorelum/judge-testing")).toBe(
      true,
    );
  });
});
