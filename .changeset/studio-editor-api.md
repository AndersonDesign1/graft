---
"@usegraft/studio": minor
"@usegraft/cli": minor
---

Studio has an editor API on top of the content store. `GET /entries` returns a page of a collection searched, filtered, sorted and faceted on the server, from a listing that re-parses only files whose size or mtime changed, so a catalog of thousands stays fast. `GET/PUT/POST/DELETE /entry` and `POST /entry/duplicate` read, save, create (slug from the title), delete and copy entries; saves carry the version they were read at and a stale one is refused with `CONTENT_CONFLICT`. `/drafts`, `/drafts/diff`, `/drafts/publish` and `/drafts/discard` list unpublished changes, diff them, publish them and throw them away: a commit locally, a commit on the production branch or a pull request on GitHub. `GET /workspace` says where saves land and what Publish does for the caller. `graft serve --studio` writes through GitHub when `GRAFT_GITHUB_REPO` is set.
