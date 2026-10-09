---
"@usegraft/studio": minor
---

Remove `GET` and `PUT /api/studio/v1/document` and the `DocumentDto` type. Use `GET` and `PUT /api/studio/v1/entry`, which read and save the same files, carry a version for conflict detection, and work against a GitHub store too. An entry deleted in a draft now stays in `/entries` as `status: "deleted"`, and `GET /entry` returns its published copy so it can be read or restored.
