## Why

Issue #42 found that the public `identityOf` and `canonicalForm` take raw input and hash it without a copy. `canonicalize` calls `toJSON`, so `identityOf('x', new Date(0))` equals the identity of the ISO string. A class instance hashes as a plain object, a throwing getter escapes as a plain `Error`, and a lone surrogate or deep nesting escapes the same way. These functions are exported, so every caller inherits the gap. The copy routine (`snapshot`, #39) also has three smaller holes: it drops `undefined`-valued properties, silently ignores symbol and non-enumerable keys, and does not reject lone-surrogate keys.

## What Changes

- `identityOf` and `canonicalForm` accept `unknown`, copy the input with `snapshot` first, and return a structured failure for any input the copy rejects, including a thrown getter.
- `snapshot` keeps an own property whose value is `undefined` in the copy, so the schema and the identity both see the caller's input as written.
- `snapshot` rejects symbol keys, non-enumerable own properties, lone-surrogate keys, and extra own properties on arrays.
- The "identityOf is exempt" exception in the Input-is-read-once requirement is removed.

## Impact

- Breaking for direct callers of `identityOf` and `canonicalForm`: the parameter type widens to `unknown`, and inputs that were hashed before (a `Date`, a class instance, a `toJSON`) now fail. Internal callers already pass plain copies, so their output does not change.
- Breaking for callers that relied on `undefined`-valued properties being dropped. Such inputs now fail identity with reason `undefined`, as `identityOf` already did for direct calls.
- No change to any identity of plain, valid input. Existing golden identities in #6 and #8a tests must stay equal.
