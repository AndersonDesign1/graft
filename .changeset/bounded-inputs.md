---
"@usegraft/core": minor
"@usegraft/registry": minor
---

Field builders can bound what they accept, and query limits are clamped
server-side.

`FieldOptions` carried only `optional` and `description`, so every authored
string and every public form input compiled to a bare `z.string()` and was
written verbatim into an unbounded jsonb column. A single anonymous request
could store megabytes; an unbounded quantity multiplied by a price silently
exceeded `Number.MAX_SAFE_INTEGER` and stored a wrong total rather than being
rejected.

**New options:** `maxLength` (string/text), `min` / `max` / `int` (number),
`pattern` (string/text), and `maxItems` on `field.array`.

**Breaking:**

- `listRecords` clamps `limit` to `MAX_RECORD_LIMIT` (500) and coerces nonsense
  values to the default. It previously passed a caller-supplied number straight
  to `LIMIT`, so a public query could ask for a billion rows — or a negative
  one, which made Postgres error.
- `listRecords` gains `match`, which filters on `data` fields **in SQL**.
  Filtering after the row cap is a correctness bug, not just a slow path:
  non-matching rows still consume the window. `listComments` filtered
  `approved && pageSlug` in JavaScript afterwards, so posting enough unapproved
  comments emptied every approved comment on every page, silently.

The bundled `comments` and `commerce` primitives now bound every input,
`placeOrder` caps `items` at 100, and `loadProducts` batches the catalog lookup
into one `inArray` query instead of one round-trip per slug — that loop ran
_before_ unknown slugs were rejected, so a request full of bogus slugs held a
pooled connection for thousands of serial queries and only then failed
validation.

`products.currency` is constrained to three letters, so one malformed product
can no longer take down the catalog page via `Intl.NumberFormat`.
