# @lorelum/judge

Owns judge domain rules and workflows: task framing, rubric authoring, evidence
collection, judgment, calibration, and gate decisions.

It consumes `@lorelum/judge-protocol` and `@lorelum/judge-runtime`. It does not
own provider SDKs, framework orchestration, or the engineering implementation
workflow. Measurement behavior lands through #6 to #10.
