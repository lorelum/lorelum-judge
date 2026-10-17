import { describe, expect, test } from "bun:test";
import { createFindingPresentationModel, renderFinding } from "../src/gate-presentation.js";
import { criterion } from "./calibration-gate.fixtures.js";

describe("gate finding presentation", () => {
  test("uses one language-independent explanation model for both locales", () => {
    const model = createFindingPresentationModel({
      criterion: criterion("compile", "build-log"),
      outcome: "indeterminate",
      reason: "unavailable_evidence",
      failureCategories: ["evidence"],
      evidenceStatuses: [{ evidenceId: "build-log", status: "unavailable" }],
      requiredEvidenceIds: ["build-log"],
    });

    expect(model.messageKey).toBe("evidence_failure");
    expect(model.actionKey).toBe("evidence_remediation");
    const chinese = renderFinding(model, "zh-CN");
    const english = renderFinding(model, "en-US");
    expect(chinese.message).toContain("build-log：当前不可读取");
    expect(chinese.nextStep).toContain("恢复不可读取证据的访问");
    expect(english.message).toContain("build-log: currently unavailable");
    expect(english.nextStep).toContain("restore access to the unavailable evidence");
  });

  test("selects optional disagreement once and renders the matching anchor", () => {
    const model = createFindingPresentationModel({
      criterion: criterion("implementation", "diff"),
      outcome: "advisory",
      reason: "disagreement",
      verdict: "unmet",
      failureCategories: [],
      evidenceStatuses: [],
      requiredEvidenceIds: [],
    });

    expect(model.messageKey).toBe("optional_disagreement");
    expect(model.actionKey).toBe("disagreement");
    expect(renderFinding(model, "zh-CN").message).toContain(
      "当前多数判断：The requirement is not met",
    );
    expect(renderFinding(model, "en-US").message).toContain(
      "Current majority judgment: The requirement is not met",
    );
  });

  test("keeps evidence repair order deterministic and independent of input ordering", () => {
    const model = createFindingPresentationModel({
      criterion: criterion("build", "missing"),
      outcome: "indeterminate",
      reason: "missing_evidence",
      failureCategories: ["evidence"],
      evidenceStatuses: [
        { evidenceId: "unavailable", status: "unavailable" },
        { evidenceId: "missing", status: "missing" },
      ],
      requiredEvidenceIds: ["missing", "unavailable"],
    });
    const step = renderFinding(model, "zh-CN").nextStep;
    expect(step.indexOf("补充尚未采集的证据")).toBeLessThan(step.indexOf("恢复不可读取证据的访问"));
  });
});
