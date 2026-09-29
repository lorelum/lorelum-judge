# @lorelum/judge-cli

Owns command parsing, configuration assembly, workflow invocation, report
rendering, and process exit behavior.

It consumes public package APIs and must not define new measurement or workflow
semantics. CLI behavior begins in the change that introduces a real command.
