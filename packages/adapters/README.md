# Judge Adapters

Package: `@lorelum/judge-adapters`.

Provider and infrastructure implementations for ports declared by the runtime
and judge packages.

Provider-specific packages are created when an SDK, authentication model, or
release cadence warrants an independent package. Concrete SDK integrations use
`packages/provider-*`. No provider type may leak into `protocol`, `runtime`,
`judge`, or `workflow`.
