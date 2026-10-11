## MODIFIED Requirements

### Requirement: Input is read once

Every function in `packages/protocol` that takes untrusted input MUST copy that input into plain data once and MUST validate, hash, and return the copy. This covers each validator, each identity function (including `identityOf` and `canonicalForm`), `evaluateEnforcement`, and `measurementKey`, including the evidence list that `measurementKey` receives. The copy MUST accept only plain objects and arrays, MUST read own enumerable string keys and each value exactly once, and MUST NOT call `toJSON`.

The copy MUST reject, as a structured failure naming the path: symbol keys; non-enumerable own properties; string keys that are lone surrogates; extra own properties on arrays; array holes; `undefined` array elements; functions, symbols, bigints, and non-finite numbers; lone-surrogate strings; cycles; `Date`; boxed primitives; class instances; and any input whose reading throws.

An own property whose value is `undefined` MUST be kept in the copy, so that a validator and an identity function see the input as the caller wrote it.

An identity function MUST report the first rejected value in traversal order, with its path and its reason: `undefined`, `not_finite`, `bigint`, or `unsupported`. A node's own structural defects (a symbol key, a non-enumerable property, an extra array property) are reported before any defect in that node's children. Where the copy stops at a location, the path is that location; where a getter throws before any location is known, the path is `$`.

Properties that exist only on the prototype MUST NOT be validated yet omitted from a hash, and a getter MUST NOT be able to return different data to the validation and to the hash.

#### Scenario: Inherited fields are rejected

- **WHEN** a contract's required fields exist only on its prototype
- **THEN** the function returns a failed result and no identity

#### Scenario: A getter is read once

- **WHEN** a field is a getter that returns a different value on each read
- **THEN** the getter is read exactly once and the identity covers the value that was read

#### Scenario: A value is not converted into another type

- **WHEN** a string field holds a `Date` or a boxed `String`, or the input has a `toJSON` method
- **THEN** validation fails and `toJSON` is not called

#### Scenario: A lone surrogate is invalid everywhere

- **WHEN** a text field contains a lone surrogate
- **THEN** both validation and the identity function fail

#### Scenario: Identity of an untrusted date fails

- **WHEN** `identityOf` is called with a `Date` as the value
- **THEN** it returns a failed result and does not hash the date's string form

#### Scenario: Identity of an untrusted throwing getter fails

- **WHEN** `identityOf` is called with an object whose getter throws
- **THEN** it returns a failed result and does not throw

#### Scenario: An undefined property is not hashed as absent

- **WHEN** a validated record has an own property whose value is `undefined`
- **THEN** its identity fails with reason `undefined`

#### Scenario: A symbol-keyed or hidden property is rejected

- **WHEN** an input has a symbol key or a non-enumerable own property
- **THEN** the copy rejects it with a structured failure naming the path
