# landing-page — Graft example (wow loop + runtime + registry)

Minimal Next.js app rendering **real MDX** from Graft's `content_index`, with
typed functions, comments/commerce primitives, and a product catalog.

Agents: start with [llms.txt](./llms.txt).

```powershell
# from the repo root (DATABASE_URL must be in .env)
pnpm --filter landing-page compile   # project content/ into Postgres
pnpm --filter landing-page dev       # http://localhost:3000
```

- Home: Callout/FAQ blocks + contact form
- `/products`: file-authoritative catalog + `placeOrder`
- Primitives under `graft/` (from `graft add`); MDX map at `components/mdx-components.ts`

Pages are `dynamic` (read the index per request). Cache tags via
`revalidateContent` / `POST /api/revalidate` are available as an opt-in.
