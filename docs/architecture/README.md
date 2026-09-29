# Architecture Review Dossier

This directory records why Lorelum Judge uses its current layers and how an
external reviewer can check the foundation without relying on issue discussion
or chat context.

## Recommended Reading Order

1. [Design rationale](design-rationale.md): the problem, the build order, the
   current package graph, and the trade-offs.
2. [Agent framework survey](agent-framework-survey.md): which framework ideas
   were considered and why no framework is selected yet.
3. [Directory survey](directory-survey.md): which repository layouts were
   reviewed and which patterns were adopted or rejected.
4. [Foundation review guide](foundation-review-guide.md): exact files to
   inspect, commands to run, expected results, and failure conditions.
5. [Architecture decisions](../decisions/README.md): the accepted ADRs behind
   the package and framework boundaries.

## Review Scope

These documents cover the repository, package, runtime, and process foundation.
They do not claim that the measurement layer or engineering workflow is
implemented or validated. Those remain under issues #5 through #11.

## Current Status

The foundation is implemented on stacked change branches:

- bootstrap repository baseline;
- package boundaries and import enforcement;
- framework-neutral runtime and conformance behavior.

The documents describe the intended architecture and the evidence a reviewer
should verify. They do not replace the later measurement-contract and workflow
reviews.
