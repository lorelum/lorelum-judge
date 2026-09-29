# Repository Rules

- Preserve the dependency direction documented in
  `docs/architecture/repository-layout.md`.
- Keep imports inside the workspace package graph enforced by
  `scripts/check-layers.ts`. Use package public entrypoints across package
  boundaries; relative imports may not escape a package.
- Keep protocol types and domain rules independent from provider SDKs, agent
  frameworks, benchmark fixtures, and CLI concerns.
- Version every persisted or imported contract. A change in identity-bearing
  input must produce a different canonical hash.
- Do not introduce hidden defaults, silent truncation, or implicit fallback
  when evidence or measurement identity is incomplete.
- Prefer deterministic validation before model judgment. Model output is
  untrusted input and must be validated before it can drive control flow.
- Add focused tests for every contract change. Run `bun run validate` before
  considering a change complete.
