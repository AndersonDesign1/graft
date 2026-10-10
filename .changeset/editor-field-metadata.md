---
"@usegraft/core": minor
"@usegraft/contracts": minor
---

Fields can say how an editor should see them. `field.select({ options })` holds one value from a fixed list, `field.reference({ to })` holds the slug of a document in another collection, every field takes a `label`, and `field.number({ format: "money" })` declares an amount in the smallest currency unit. `describe_schema` now includes each field's label, limits (`min`, `max`, `int`, `maxLength`, `pattern` with its flags, `maxItems`, each only for the field types that enforce it), options and reference target, so Studio and agents see the rules the validator applies.
