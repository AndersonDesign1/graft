---
"@usegraft/studio": minor
---

Set one field on many entries at once. Select entries in a collection's list
and choose **Set a field**: pick the field and its value with the same
control the entry editor uses, and Studio saves each entry as a draft.
Nothing goes live until it is published. Entries that can't be saved are
listed in the dialog with the reason and stay selected; the rest are saved.

The API behind it is `POST /api/studio/v1/entries/field`:

```json
{
  "collection": "products",
  "slugs": ["wool-hat", "linen-shirt"],
  "field": "status",
  "value": "archived"
}
```

Each entry is validated and written exactly as `PUT /entry` would, against
the version read just before the write. `"value": null` removes an optional
field. A local Studio updates the index once for the whole batch. The answer
lists `saved` entries with their new versions and `failed` entries with their
error code, message and fix.

On a phone, the bulk bar's buttons now wrap instead of running off the screen.
