---
"@usegraft/mcp": patch
---

**Security:** `write_content` could write outside `contentDir`.

The `slug` argument was `z.string()` with no shape constraint, and the path was
built as `join(contentDir, collection, slug + ".mdx")`. `parseDocument`, which
runs afterwards, is not a guard against this: it validates
`basename(sourcePath)`, so a slug of `"../../escaped"` parses as the entirely
legal slug `"escaped"` while the join walks two directories up. Confirmed by
running it before the fix — the file landed outside the content tree and the
call returned success, not an error.

Any caller holding `content:write` could therefore write an arbitrary file
anywhere the server process could. That is most of the point of the scope on a
local stdio server, and not at all the point on an HTTP mount.

Two independent defences, each verified to hold on its own:

- `assertSlugShape` rejects a non-kebab-case slug in the handler with
  `INVALID_SLUG` and a `fix`. Deliberately not a `.regex()` on the input
  schema — zod rejects before the tool body runs and the SDK surfaces that as a
  bare protocol error with no `fix`, which is the self-teaching an agent most
  needs when the correct slug is one edit away.
- `resolveContained` decides where bytes actually land, so the guarantee does
  not rest on the check above still being there.

`delete_content` gets the same slug check, ahead of `findDoc` and ahead of the
approval, so a malformed slug never reaches a human as a pending decision.

The **document resource read** and the **delete** now resolve through
`resolveContained` too. Those follow a `sourcePath` produced by a directory
scan, which a caller cannot inject — but the scan lists a symlink like any
other entry, and following one would serve or unlink a file outside the content
tree. That matters most on the read, because the read-only documentation server
is an unauthenticated mount. Raised by cubic on the pull request; the write
traversal above was found by pulling on it.
