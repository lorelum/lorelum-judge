# protocol-canonical-identity Specification

## Purpose
Give structured records a stable, content-derived identity so that changes to a
record invalidate anything bound to its earlier identity.

## Requirements

### Requirement: Identity is derived from content

`identityOf(schema, value)` MUST return an identity of the form
`sha256:<64 lowercase hex characters>` computed over the canonical serialization
of `{"schema": schema, "value": value}`. The same schema and content MUST always
produce the same identity, regardless of object key order.

#### Scenario: Key order does not matter

- **WHEN** two values have the same fields in different key order
- **THEN** their identities are equal

#### Scenario: Any content change changes identity

- **WHEN** one field value, one array element, or one array position changes
- **THEN** the identity differs

#### Scenario: Record types do not collide

- **WHEN** the same value is hashed under two different schema identifiers
- **THEN** the identities differ

### Requirement: Canonical form follows RFC 8785

Serialization MUST follow RFC 8785 for the JSON subset of objects, arrays,
strings, finite numbers, booleans, and null.

#### Scenario: Subset test vectors match

- **WHEN** the RFC 8785 test vectors that fall inside the supported subset are
  serialized
- **THEN** the output equals the published canonical form

### Requirement: Silently changed inputs are rejected

Input that serialization would silently rewrite or drop MUST NOT produce an
identity. `undefined` values, `NaN`, `Infinity`, `-Infinity`, and `bigint` MUST
return a structured error identifying the path of the offending value.

#### Scenario: Undefined field is rejected

- **WHEN** a value contains a field set to `undefined`
- **THEN** `identityOf` returns `ok: false` with the path, and does not return an
  identity equal to the one for the value without that field

#### Scenario: Non-finite number is rejected

- **WHEN** a value contains `NaN` or `Infinity`
- **THEN** `identityOf` returns `ok: false` with the path

### Requirement: Errors are structured values

`identityOf` MUST NOT throw for invalid input. It MUST return
`{ ok: true, identity }` or `{ ok: false, error }`.

#### Scenario: Invalid input does not reject

- **WHEN** `identityOf` receives an unsupported value
- **THEN** it returns a result object and does not throw

### Requirement: Protocol has no workspace dependency

`@lorelum/judge-protocol` MUST NOT depend on another workspace package. It MAY
depend on a small number of external packages.

#### Scenario: Layer check passes

- **WHEN** `bun run check:layers` runs
- **THEN** it passes with `protocol` declaring only external dependencies

### Requirement: Built entrypoint loads in Node ESM

The built `protocol` entrypoint MUST load in Node ESM, including its external
dependency.

#### Scenario: Dist smoke test

- **WHEN** `bun run check:dist` runs after the build
- **THEN** the protocol entrypoint loads successfully
