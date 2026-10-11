## Why

#6 lets a verdict cite evidence ids, but nothing says whether that evidence
existed, whether the judge was actually shown it, or whether it was cut short.
AGENTS.md 4.3 requires that missing evidence is never forged into a failure and that
no-evidence, unavailable, truncated, and contradiction stay distinct. Without a
contract for what was rendered, a verdict can cite evidence the model never saw.

## What Changes

- Add `EvidenceItem` and `EvidenceBundle` JSON Schemas, generated types, and
  validators in `@lorelum/judge-protocol`.
- Add item statuses `present`, `no_evidence`, `unavailable`, `contradiction`, and
  render states `rendered`, `withheld`, `truncated` with recorded lengths.
- Add `validateEvidenceBundle`, `validateVerdictEvidence`, and
  `evidenceBundleIdentity`.

## Impact

Contract-class change to `packages/protocol`. No runtime, judge, or workflow
package changes. Prompt specs, the prompt compiler, truncation, and untrusted
content marking belong to #7b. Calibration statistics belong to #9.
