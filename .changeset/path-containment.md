---
"@usegraft/compiler": minor
"@usegraft/registry": minor
"@usegraft/studio": minor
"@usegraft/mcp": minor
"@usegraft/cli": minor
---

One path-containment helper, and it refuses symlinks.

`resolveContained(root, path)` (new, in `@usegraft/compiler`) checks the bytes
_and_ the filesystem. Lexical containment — `resolve` plus a prefix check —
only answers "does this string stay under the root", which a symlink **inside**
the root silently defeats: `docs/notes.mdx -> ~/.ssh/id_rsa` passes every string
test and `readFileSync` then follows it. Git can commit symlinks, so a cloned
template can plant one.

**Breaking:**

- MCP `put_asset` no longer reads arbitrary server paths. Its `path` argument
  requires the new `localUploadRoot` option, which only `graft mcp` sets (to the
  project directory) — every remote mount refuses it. Previously the raw string
  went to `readFileSync`, the bytes were stored under a caller-chosen key, and
  the response included a fetchable URL, so one call read `.env` off the server.
- Studio `writeDocument` validates the slug against `SLUG_RE` and contains the
  resulting path. `parseDocument`'s existing check did not help: it validates
  `basename(sourcePath)`, which strips exactly the `..` segments that make a
  path dangerous.
- `loadItem` validates the item name before joining it onto the registry root.
  `describe_item` passed a raw MCP argument through, and the three error
  branches were distinguishable — a filesystem existence oracle.
- `safeContentPath` now refuses symlinks, so a hostile repository can no longer
  leak files through the changes-diff endpoint.

Also fixes `looksBinary`, which read an entire file into memory to inspect its
first 8KB — one large file made every diff render allocate all of it.

`SLUG_RE` is now exported from `@usegraft/compiler`.
