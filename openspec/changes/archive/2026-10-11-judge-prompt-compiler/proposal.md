## Why

#7a records what evidence existed and what the judge was shown, but nothing produces
that record from raw material, and `InstrumentProfile.promptIdentity` is still typed in
by hand. A caller can therefore say a prompt was rendered one way while the model saw
another. The prompt compiler makes the messages, the manifest, and the identities come
from one code path.

## What Changes

- Add `compilePrompt` in `@lorelum/judge`: rules and raw
  evidence in, `RuntimeMessage[]`, a validated `EvidenceBundle` manifest, and three
  identities out.
- Render evidence in id order under a character budget, recording rendered, withheld,
  and truncated states.
- Add minimal template variables: every `{{name}}` bound, nothing extra, `{{evidence}}`
  reserved and exactly once.
- Normalize mechanical differences before hashing.

## Impact

First real code in `packages/judge`. Depends on `protocol` and `runtime` only, as
`scripts/check-layers.ts` already allows. `protocol` is unchanged. Calibration and gate
semantics remain in #9.
