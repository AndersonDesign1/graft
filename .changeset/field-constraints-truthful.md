---
"@usegraft/core": patch
"@usegraft/contracts": patch
"@usegraft/studio": patch
---

Field descriptors now match what the validator checks. A pattern's flags are kept in the new `constraints.patternFlags`, so Studio checks `/^[a-z]+$/i` case-insensitively like the server does instead of flagging valid values. Constraints are listed only for the field types that enforce them: `field.string({ min: 10 })` validates nothing, so `describe_schema` no longer advertises a minimum for it.
