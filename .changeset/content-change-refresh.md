---
"@usegraft/compiler": minor
"@usegraft/contracts": minor
"@usegraft/mcp": minor
"@usegraft/studio": minor
"@usegraft/cli": minor
---

Graft now tells your app when content changes, so its cache refreshes without
a manual call.

Before this, an agent's `write_content` or a Studio save updated the index and
returned the ChangeSet to the caller. The app kept serving its cached pages
until someone called its revalidate route by hand.

**Webhook.** Set `GRAFT_REVALIDATE_URL` and `GRAFT_WEBHOOK_SECRET` where
`graft serve`, `graft studio`, `graft mcp`, `graft merge` or `graft migrate`
runs. After each write that changes content, Graft POSTs
`{ branch, gitSha, changes }` with `Authorization: Bearer <secret>`, the body
the documented revalidate route already reads. The URL must use https, except
on loopback (`localhost`, `127.0.0.1`, `[::1]`), and redirects are refused. A URL without a secret stops the
command before it connects to anything. `graft compile` does not call the
route, because a deploy compiles before the new version is live.

**Hook.** `createGraftMcp`, `createGraftMcpHandler`, `createStudioApiHandler`
and `createStudioHandler` take `onContentChange(event)`. An app that mounts the
MCP endpoint itself refreshes in-process:

```ts
createGraftMcpHandler({
  // …
  onContentChange: ({ branch, changes }) => {
    revalidateContent(branch, changes);
  },
});
```

`@usegraft/compiler` exports the pieces: `notifyContentChange`,
`createRevalidateWebhook`, `revalidateWebhookFromEnv` and the
`ContentChangeEvent` / `ContentChangeListener` types.

**A failed refresh never fails the write.** The write already landed. The
server logs the new `REVALIDATE_FAILED` error, `write_content` and
`delete_content` return `refresh: { ok: false, error, message, fix }`, and
Studio shows a warning toast. Writes that change nothing do not call the
listener.

Also fixed: saving a document with an empty body a second time appended a
newline to the file, so it projected as a change. `composeDocument` now leaves
a body-less document byte-identical.
