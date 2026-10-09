---
"@usegraft/compiler": minor
"@usegraft/contracts": minor
"@usegraft/mcp": minor
---

Add the content store: where authored content is read from and written to, behind one interface. `FilesystemStore` is today's behaviour. `GitHubStore` writes through the GitHub REST API, so a hosted surface on a read-only filesystem can save: each editor drafts on their own branch, and publishing lands one commit on the production branch authored by the editor, or opens a pull request. Every write can carry the version it was read at and is refused with the new `CONTENT_CONFLICT` code when the document changed underneath it, which covers a second tab, a second editor and an agent editing the same file. Publishing refuses to overwrite a document production changed since the draft began until someone chooses to keep the draft or take the published version. Credentials are a fine-grained token (`GRAFT_GITHUB_TOKEN`) or a GitHub App (`GRAFT_GITHUB_APP_ID`, `GRAFT_GITHUB_APP_PRIVATE_KEY`); `githubStoreFromEnv` reads the configuration. GitHub failures surface as `REMOTE_STORE_FAILED` with GitHub's own message. `@usegraft/compiler/testing` exports an in-memory GitHub for tests.
