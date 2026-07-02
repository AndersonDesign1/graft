# landing-page — the Graft wow loop

A minimal Next.js app rendering pages from Graft's `content_index`. Authoring
workflow: edit MDX → `pnpm compile` → refresh. Agents: start with
[llms.txt](./llms.txt).

```powershell
# from the repo root (DATABASE_URL must be in .env)
pnpm --filter landing-page compile   # project content/ into Postgres
pnpm --filter landing-page dev       # http://localhost:3000
```

Pages are `dynamic` (read the index per request), so new content shows up on
refresh without a rebuild. Cache invalidation via `revalidateTag` lands in
Phase 4.
