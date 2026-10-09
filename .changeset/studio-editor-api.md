---
"@usegraft/studio": minor
"@usegraft/cli": minor
---

Studio has an editor API on top of the content store. `GET /api/studio/v1/entries` returns a page of a collection searched, filtered, sorted and faceted on the server, from a listing that re-parses only files whose size or mtime changed, so a catalog of thousands stays fast. `GET/PUT/POST/DELETE /api/studio/v1/entry` and `POST /api/studio/v1/entry/duplicate` read, save, create (slug from the title), delete and copy entries; a save that sends the version it read as `baseVersion` is refused with `CONTENT_CONFLICT` when that version is stale (a save without one is unconditional). `/api/studio/v1/drafts`, `/drafts/diff`, `/drafts/publish` and `/drafts/discard` list unpublished changes, diff them, publish them and throw them away: a commit locally, a commit on the production branch or a pull request on GitHub. `GET /api/studio/v1/workspace` says where saves land and what Publish does for the caller. `graft serve --studio` writes through GitHub when `GRAFT_GITHUB_REPO` is set along with a credential (`GRAFT_GITHUB_TOKEN`, or a GitHub App).
