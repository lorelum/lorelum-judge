# @lorelum/judge-adapters

Owns provider-neutral infrastructure such as transport, normalization, retry,
usage, streaming conversion, storage, and execution adapters.

Concrete provider SDK implementations use separate `provider-*` packages.
Framework-specific runtimes use `runtime-*` and their SDK types must not leak
through this package's public contract.
