import type { Criterion, Verdict } from "@lorelum/judge-protocol";
import {
  aggregateVerdicts,
  anyDefinitionIdentity,
  anyInstrumentIdentity,
  type CalibrationObservation,
  type EvidenceBundle,
  type GateDecision,
  type GatePolicyV2,
  gatePolicyIdentityV2,
  identityOf,
  instrumentRepetitions,
  isRequiredCriterion,
  type MeasurementRun,
  type MeasurementRunV2,
  type ValidationIssue,
  type ValidationResult,
  validateAnyDefinition,
  validateAnyInstrument,
  validateAnyRun,
  validateEvidenceBundle,
  validateGateDecision,
  validateGatePolicyForV2,
  validateVerdictEvidence,
} from "@lorelum/judge-protocol";
import { isVerifiedCalibration } from "./calibration.js";
import {
  createFindingPresentationModel,
  type GateLocale,
  renderFinding,
  renderNotApplicableFinding,
  renderSummary,
} from "./gate-presentation.js";

export type { GateLocale } from "./gate-presentation.js";

type GateFailureCategory = Extract<
  CalibrationObservation,
  { readonly status: "failed" }
>["failureCategory"];
type GateEvidenceStatus = NonNullable<
  GateDecision["findings"][number]["evidenceStatuses"]
>[number]["status"];
type GateEvidenceStatusEntry = NonNullable<
  GateDecision["findings"][number]["evidenceStatuses"]
>[number];

export type GateObservation =
  | {
      readonly status: "completed";
      readonly id: string;
      readonly run: unknown;
      readonly evidenceBundle: unknown;
    }
  | {
      readonly status: "partial";
      readonly id: string;
      readonly verdicts: readonly Verdict[];
      readonly evidenceBundle: unknown;
    }
  | Extract<CalibrationObservation, { readonly status: "failed" }>;

export interface EvaluateGateInput {
  readonly id: string;
  readonly definition: unknown;
  readonly instrument: unknown;
  readonly policy: unknown;
  readonly taskClass: string;
  readonly evidenceShape: string;
  readonly observations: readonly GateObservation[];
  readonly calibration?: unknown;
  readonly now: string;
  readonly locale?: GateLocale;
}

type ParsedObservation =
  | {
      readonly status: "completed";
      readonly run: MeasurementRun | MeasurementRunV2;
      readonly evidenceBundle: EvidenceBundle;
    }
  | {
      readonly status: "partial";
      readonly verdicts: readonly Verdict[];
      readonly evidenceBundle: EvidenceBundle;
    }
  | {
      readonly status: "failed";
      readonly failure: GateFailureCategory;
      readonly evidenceBundle?: EvidenceBundle;
    };

interface CriterionResult {
  readonly finding: GateDecision["findings"][number];
  readonly mandatory: boolean;
}

function requiredEvidenceStatuses(
  criterion: Criterion,
  bundle: EvidenceBundle,
): GateEvidenceStatusEntry[] {
  return criterion.evidence.map((selector) => {
    const item = bundle.items.find((entry) => entry.id === selector.evidenceId);
    let status: GateEvidenceStatus;
    if (item === undefined || item.status === "no_evidence") status = "missing";
    else if (item.status === "unavailable") status = "unavailable";
    else if (item.status === "contradiction") status = "contradiction";
    else if (item.render?.state === "truncated") status = "truncated";
    else if (item.render?.state === "withheld" || item.render?.renderedLength === 0)
      status = "unsupported";
    else status = "available";
    return { evidenceId: selector.evidenceId, status };
  });
}

function evaluateCriterion(
  criterion: Criterion,
  required: boolean,
  policy: GatePolicyV2["criteria"][number],
  observations: readonly ParsedObservation[],
  minimumAgreement: number,
  locale: GateLocale,
): CriterionResult {
  const votes: Verdict["verdict"][] = [];
  const evidenceIds = new Set<string>();
  const failureCategories = new Set<GateFailureCategory>();
  let evidenceFailure = false;
  let executionFailure = false;
  let measurementFailure = false;
  let unattributedFailure = false;
  let missingRequiredEvidence = false;
  let unavailableRequiredEvidence = false;
  const evidenceStatusEntries = new Map<string, GateEvidenceStatusEntry>();
  for (const observation of observations) {
    if (observation.status === "failed") {
      failureCategories.add(observation.failure);
      if (observation.evidenceBundle !== undefined) {
        const statuses = requiredEvidenceStatuses(criterion, observation.evidenceBundle);
        for (const entry of statuses)
          evidenceStatusEntries.set(`${entry.evidenceId}\0${entry.status}`, entry);
        if (observation.failure === "evidence") {
          evidenceFailure = true;
          missingRequiredEvidence ||= statuses.some((entry) => entry.status === "missing");
          unavailableRequiredEvidence ||= statuses.some((entry) => entry.status === "unavailable");
        }
      } else if (observation.failure === "evidence") {
        evidenceFailure = true;
      }
      if (observation.failure === "provider" || observation.failure === "execution") {
        executionFailure = true;
      } else if (observation.failure === "unattributed") {
        unattributedFailure = true;
      } else if (observation.failure !== "evidence") {
        measurementFailure = true;
      }
      continue;
    }
    const evidenceBundle = observation.evidenceBundle;
    const verdict =
      observation.status === "completed"
        ? observation.run.verdicts.find((entry) => entry.criterionId === criterion.id)
        : observation.verdicts.find((entry) => entry.criterionId === criterion.id);
    if (verdict === undefined) {
      executionFailure = true;
      continue;
    }
    const currentEvidenceStatuses = requiredEvidenceStatuses(criterion, evidenceBundle);
    for (const entry of currentEvidenceStatuses) {
      evidenceStatusEntries.set(`${entry.evidenceId}\0${entry.status}`, entry);
    }
    const checked = validateVerdictEvidence(criterion, verdict, evidenceBundle);
    if (!checked.ok) {
      evidenceFailure = true;
      failureCategories.add("evidence");
      continue;
    }
    if (verdict.verdict === "unknown" || verdict.verdict === "insufficient") {
      evidenceFailure ||= currentEvidenceStatuses.some(
        (entry) => entry.status === "unsupported" || entry.status === "contradiction",
      );
      missingRequiredEvidence ||= currentEvidenceStatuses.some(
        (entry) => entry.status === "missing",
      );
      unavailableRequiredEvidence ||= currentEvidenceStatuses.some(
        (entry) => entry.status === "unavailable",
      );
    }
    for (const evidenceId of verdict.evidenceIds) evidenceIds.add(evidenceId);
    votes.push(verdict.verdict);
  }
  const aggregate = aggregateVerdicts(criterion.kind, votes, observations.length, minimumAgreement);
  const { prediction } = aggregate;
  const disagrees = aggregate.disagreement;
  const abstained = aggregate.abstained;

  let outcome: GateDecision["findings"][number]["outcome"];
  let reason: GateDecision["findings"][number]["reason"];
  if (prediction === undefined) {
    outcome = required ? "indeterminate" : "advisory";
    reason = disagrees
      ? "disagreement"
      : unavailableRequiredEvidence
        ? "unavailable_evidence"
        : missingRequiredEvidence
          ? "missing_evidence"
          : evidenceFailure
            ? "unsupported_evidence"
            : executionFailure
              ? "execution_failure"
              : measurementFailure
                ? "measurement_failure"
                : unattributedFailure
                  ? "unattributed_failure"
                  : abstained
                    ? "abstention"
                    : "missing_evidence";
  } else if (!policy.acceptedVerdicts.some((verdict) => verdict === prediction)) {
    outcome = required ? "fail" : "advisory";
    reason = disagrees ? "disagreement" : "unacceptable";
  } else {
    outcome = required ? "pass" : "advisory";
    reason = disagrees ? "disagreement" : "acceptable";
  }
  const requiredEvidenceIds =
    prediction === undefined &&
    (reason === "missing_evidence" ||
      reason === "unavailable_evidence" ||
      reason === "unsupported_evidence")
      ? criterion.evidence.map((selector) => selector.evidenceId)
      : [];
  const normalizedEvidenceStatuses = [...evidenceStatusEntries.values()].sort((left, right) => {
    if (left.evidenceId !== right.evidenceId) return left.evidenceId < right.evidenceId ? -1 : 1;
    if (left.status !== right.status) return left.status < right.status ? -1 : 1;
    return 0;
  });
  const hasEvidenceIssue = normalizedEvidenceStatuses.some((entry) => entry.status !== "available");
  const normalizedFailureCategories = [...failureCategories].sort();
  const presentation = createFindingPresentationModel({
    criterion,
    outcome,
    reason,
    ...(prediction === undefined ? {} : { verdict: prediction }),
    failureCategories: normalizedFailureCategories,
    evidenceStatuses:
      prediction === undefined || hasEvidenceIssue ? normalizedEvidenceStatuses : [],
    requiredEvidenceIds,
    qualifiedDisagreement: prediction !== undefined && disagrees,
    partialEvidenceStatuses:
      prediction !== undefined && hasEvidenceIssue ? normalizedEvidenceStatuses : [],
  });
  const rendered = renderFinding(presentation, locale);
  return {
    mandatory: required,
    finding: {
      criterionId: criterion.id,
      criterionDescription: criterion.description,
      outcome,
      reason,
      message: rendered.message,
      ...(normalizedFailureCategories.length > 0
        ? { failureCategories: normalizedFailureCategories }
        : {}),
      evidenceIds: [...evidenceIds],
      ...((prediction === undefined || hasEvidenceIssue) && normalizedEvidenceStatuses.length > 0
        ? { evidenceStatuses: normalizedEvidenceStatuses }
        : {}),
      requiredEvidenceIds,
      nextStep: rendered.nextStep,
    },
  };
}

export function evaluateGate(input: EvaluateGateInput): ValidationResult<GateDecision> {
  try {
    const locale = input.locale ?? "zh-CN";
    const definitionResult = validateAnyDefinition(input.definition);
    const instrumentResult = validateAnyInstrument(input.instrument);
    const policyResult = validateGatePolicyForV2(input.policy, input.definition, input.instrument);
    const issues: ValidationIssue[] = [
      ...(!definitionResult.ok ? definitionResult.issues : []),
      ...(!instrumentResult.ok ? instrumentResult.issues : []),
      ...(!policyResult.ok ? policyResult.issues : []),
    ];
    if (!definitionResult.ok || !instrumentResult.ok || !policyResult.ok)
      return { ok: false, issues };
    const repetitions = instrumentRepetitions(instrumentResult.value);
    if (input.observations.length > repetitions) {
      return {
        ok: false,
        issues: [
          {
            path: "$.observations",
            code: "report_mismatch",
            message: `expected at most ${repetitions} observations`,
          },
        ],
      };
    }
    const definitionId = anyDefinitionIdentity(definitionResult.value);
    const instrumentId = anyInstrumentIdentity(instrumentResult.value);
    const policyId = gatePolicyIdentityV2(policyResult.value);
    if (!definitionId.ok || !instrumentId.ok || !policyId.ok) {
      return {
        ok: false,
        issues: [
          ...(!definitionId.ok ? definitionId.issues : []),
          ...(!instrumentId.ok ? instrumentId.issues : []),
          ...(!policyId.ok ? policyId.issues : []),
        ],
      };
    }

    const selectedScope = policyResult.value.scopes.find(
      (scope) => scope.taskClass === input.taskClass && scope.evidenceShape === input.evidenceShape,
    );
    const verified = isVerifiedCalibration(input.calibration) ? input.calibration : undefined;
    const artifact = verified?.artifact;
    const now = Date.parse(input.now);
    const selectedScopeIdentity =
      selectedScope === undefined
        ? undefined
        : identityOf("lorelum.judge.calibration-scope/v1", selectedScope);
    const calibrationMatches =
      verified !== undefined &&
      artifact !== undefined &&
      (artifact.status === "enforced" ||
        artifact.status === "shadow" ||
        artifact.status === "diagnostic") &&
      Number.isFinite(now) &&
      Date.parse(artifact.validFrom) <= now &&
      now < Date.parse(artifact.validUntil) &&
      verified.definitionIdentity === definitionId.identity &&
      verified.instrumentIdentity === instrumentId.identity &&
      artifact.policyIdentity === policyId.identity &&
      selectedScope !== undefined &&
      selectedScopeIdentity?.ok === true &&
      artifact.scopeIdentity === selectedScopeIdentity.identity &&
      selectedScope.criterionIds.every((criterionId) =>
        artifact.scope.criterionIds.includes(criterionId),
      );
    const executionMode: GateDecision["executionMode"] =
      artifact?.status === "enforced" && calibrationMatches
        ? "enforced"
        : artifact?.status === "shadow" && calibrationMatches
          ? "shadow"
          : artifact?.status === "diagnostic" && calibrationMatches
            ? "diagnostic"
            : selectedScope === undefined
              ? "indeterminate"
              : policyResult.value.onUncalibrated;

    const observationIds = new Set<string>();
    const runIds = new Set<string>();
    const observationIssues: ValidationIssue[] = [];
    const criteria = new Map(
      definitionResult.value.criteria.map((criterion) => [criterion.id, criterion]),
    );
    const parsed: ParsedObservation[] = input.observations.map((observation, index) => {
      if (observationIds.has(observation.id)) {
        observationIssues.push({
          path: `$.observations[${index}].id`,
          code: "duplicate_verdict",
          message: `duplicate observation "${observation.id}"`,
        });
      }
      observationIds.add(observation.id);
      if (observation.status === "failed") {
        if (observation.evidenceBundle === undefined) {
          return { status: "failed", failure: observation.failureCategory };
        }
        const bundle = validateEvidenceBundle(observation.evidenceBundle);
        if (!bundle.ok) {
          observationIssues.push(
            ...bundle.issues.map((issue) => ({
              ...issue,
              path: `$.observations[${index}].evidenceBundle${issue.path.slice(1)}`,
            })),
          );
          return { status: "failed", failure: observation.failureCategory };
        }
        return {
          status: "failed",
          failure: observation.failureCategory,
          evidenceBundle: bundle.value,
        };
      }
      if (observation.status === "partial") {
        const bundle = validateEvidenceBundle(observation.evidenceBundle);
        if (!bundle.ok) {
          observationIssues.push(
            ...bundle.issues.map((issue) => ({
              ...issue,
              path: `$.observations[${index}].evidenceBundle${issue.path.slice(1)}`,
            })),
          );
          return { status: "failed", failure: "evidence" };
        }
        const seen = new Set<string>();
        for (const [verdictIndex, verdict] of observation.verdicts.entries()) {
          const criterion = criteria.get(verdict.criterionId);
          if (criterion === undefined || seen.has(verdict.criterionId)) {
            observationIssues.push({
              path: `$.observations[${index}].verdicts[${verdictIndex}].criterionId`,
              code: criterion === undefined ? "unknown_criterion" : "duplicate_verdict",
              message: `invalid partial verdict "${verdict.criterionId}"`,
            });
            continue;
          }
          seen.add(verdict.criterionId);
          const checked = validateVerdictEvidence(criterion, verdict, bundle.value);
          if (!checked.ok) {
            observationIssues.push(
              ...checked.issues.map((issue) => ({
                ...issue,
                path: `$.observations[${index}].verdicts[${verdictIndex}]${issue.path.slice(1)}`,
              })),
            );
          }
        }
        return {
          status: "partial",
          verdicts: observation.verdicts,
          evidenceBundle: bundle.value,
        };
      }
      const run = validateAnyRun(definitionResult.value, instrumentResult.value, observation.run);
      const bundle = validateEvidenceBundle(observation.evidenceBundle);
      if (run.ok) {
        if (runIds.has(run.value.id)) {
          observationIssues.push({
            path: `$.observations[${index}].run.id`,
            code: "duplicate_verdict",
            message: `measurement run "${run.value.id}" cannot count as multiple repetitions`,
          });
        }
        runIds.add(run.value.id);
      }
      if (!run.ok || !bundle.ok) {
        const evidenceFailure =
          !bundle.ok ||
          (!run.ok &&
            run.issues.some(
              (issue) =>
                issue.code === "verdict_without_evidence" || issue.code === "evidence_not_declared",
            ));
        return {
          status: "failed",
          failure: evidenceFailure ? "evidence" : "unattributed",
          ...(bundle.ok ? { evidenceBundle: bundle.value } : {}),
        };
      }
      return { status: "completed", run: run.value, evidenceBundle: bundle.value };
    });
    if (observationIssues.length > 0) return { ok: false, issues: observationIssues };
    if (input.observations.length < repetitions) {
      for (let index = input.observations.length; index < repetitions; index += 1) {
        parsed.push({ status: "failed", failure: "execution" });
      }
    }
    const rules = new Map(policyResult.value.criteria.map((rule) => [rule.criterionId, rule]));
    const applicableIds = selectedScope?.criterionIds ?? [];
    const results: CriterionResult[] = applicableIds.flatMap((criterionId) => {
      const criterion = criteria.get(criterionId);
      const rule = rules.get(criterionId);
      return criterion === undefined || rule === undefined
        ? []
        : [
            evaluateCriterion(
              criterion,
              isRequiredCriterion(definitionResult.value, criterionId),
              rule,
              parsed,
              policyResult.value.minimumAgreement,
              locale,
            ),
          ];
    });
    const findings: GateDecision["findings"][number][] = results.map((result) => result.finding);
    if (selectedScope === undefined) {
      for (const criterion of definitionResult.value.criteria) {
        findings.push(renderNotApplicableFinding(criterion, locale));
      }
    }
    const failed = results.some((result) => result.mandatory && result.finding.outcome === "fail");
    const indeterminate = results.some(
      (result) => result.mandatory && result.finding.outcome === "indeterminate",
    );
    const qualityOutcome: GateDecision["qualityOutcome"] = failed
      ? "fail"
      : indeterminate || results.length === 0
        ? "indeterminate"
        : "pass";
    const decision: GateDecision = {
      schema: "lorelum.judge.gate-decision/v1",
      id: input.id,
      definitionIdentity: definitionId.identity,
      instrumentIdentity: instrumentId.identity,
      qualityOutcome,
      executionMode,
      summary: renderSummary(qualityOutcome, executionMode, locale),
      findings,
    };
    return validateGateDecision(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      issues: [{ path: "$", code: "schema", message: `gate evaluation failed: ${message}` }],
    };
  }
}
