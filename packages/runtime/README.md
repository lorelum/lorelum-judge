# @lorelum/judge-runtime

Owns the framework-neutral agent runtime, runtime ports, step/event/state
contracts, cancellation, and tool dispatch boundaries.

It depends on `@lorelum/judge-protocol` and must not import an Agent framework,
provider SDK, rubric, verdict, calibration, or gate implementation. Its first
runtime contract is defined by #4.
