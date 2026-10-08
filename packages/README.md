# Packages

This directory contains independently versionable library boundaries. A package
exists when it owns a public contract or a real consumer boundary; it is not a
placeholder for a possible future abstraction.

Core packages:

```text
protocol/   @lorelum/judge-protocol
runtime/    @lorelum/judge-runtime
judge/      @lorelum/judge
workflow/   @lorelum/judge-workflow
testing/    @lorelum/judge-testing
```

Framework runtimes use `runtime-*`. Concrete provider SDKs use `provider-*`.
Those packages are added only when an implementation and its compatibility
policy exist.
