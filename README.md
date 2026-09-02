<h1 align="center">Graft</h1>

<p align="center">
  <strong>The agent-native CMS.</strong><br>
  Content, schema, logic, and access are code an agent edits directly.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usegraft/cli"><img alt="npm" src="https://img.shields.io/npm/v/@usegraft/cli?label=%40usegraft%2Fcli&color=111111"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-111111"></a>
  <a href="https://github.com/AndersonDesign1/graft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AndersonDesign1/graft/actions/workflows/ci.yml/badge.svg?branch=feat%2Fcore"></a>
  <img alt="Node 22.16 or newer" src="https://img.shields.io/badge/node-%3E%3D22.16-111111">
</p>

---

Most content systems put a dashboard between you and your content. Graft puts a
schema and a filesystem there instead, then gives an agent the same operator
surface a human gets.

Authored content is MDX in git. Your schema is a Zod-typed `defineCollection`
call. The queryable index is derived, so when git and the index disagree, git
wins and the compiler rebuilds. Everything a human can do in the optional
Studio, an agent can do over MCP or the CLI, under the same access rules, the
same audit trail, and the same human gate on anything destructive.

## Start with no database

A content project needs no services at all. `graft compile` writes the index to
a SQLite artifact, and your app reads it embedded.

```bash
npx @usegraft/cli@latest init      # schema, content/, llms.txt
npx @usegraft/cli@latest compile   # writes .graft/index.db
```

```ts
import { openStaticIndex } from "@usegraft/db";
import { createClient } from "@usegraft/sdk-core";
import { collections } from "./graft.config";

const index = await openStaticIndex(".graft/index.db");
const graft = createClient({ index, collections });

const home = await graft.getDocument("pages", "home");
//    ^? typed by your pages collection. No codegen step.
```

The artifact is derived from the files in git, so it is git-ignored and rebuilt
in your build command: `graft compile && next build`. Preview branches are git
branches, and each checkout compiles its own index. Full-text search comes with
it, because search is a property of the artifact.

That deploys to Vercel, Netlify, or Cloudflare Pages with nothing attached.

## Add Postgres when you need it

Postgres buys operational data (orders, submissions, comments), typed functions
with auth, audit, rate limits, and approvals, and copy-on-write preview
branches.

```bash
# set DATABASE_URL, then change one line: export const index = "postgres"
npx @usegraft/cli@latest db migrate
npx @usegraft/cli@latest compile
```

Graft tells you the moment you need it. Reaching for a Postgres-tier feature in
static mode fails with `NEEDS_DATABASE`, and that error's `fix` field is the two
commands above.

## Agents operate it

`graft mcp` serves your project over MCP, on stdio or Streamable HTTP. An agent
reads your real schema through `describe_schema` instead of guessing at it, and
every error it can hit carries a `fix` it can act on.

```jsonc
// .mcp.json
{ "mcpServers": { "graft": { "command": "npx", "args": ["-y", "@usegraft/cli@latest", "mcp"] } } }
```

The agent surface is not a subset of the human one. It reads and writes
content, uploads assets, browses and installs registry primitives, runs typed
functions, and compiles. What an agent cannot do is decide its own approval.

Destructive operations are human-gated under every policy. The call returns 403
with a pending approval id, a human runs `graft approve <id>`, and the caller
retries carrying that id. The deciding identity is derived from the verified
caller and never read from the request, so no argument exists that an agent
could set to approve itself. On Postgres, `graft harden` moves that guarantee
below the application: the runtime role holds no `UPDATE` on `approvals`, which
puts `pending → approved` out of reach even through raw SQL.

## Primitives you own

`graft add` copies a primitive's files into your repository, shadcn-style. You
own the copy and edit it like the rest of your code. No version of it sits in
`node_modules` to fight with.

```bash
graft add commerce
```

Available today: `seo`, `callout`, `faq`, `scoped-access`, `comments`, and
`commerce` (file-authoritative products, database-authoritative orders, and the
place, list, update, and cancel functions).

## Read it from your framework

| Package                                                       | Framework                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`@usegraft/sdk-next`](packages/sdk-next)                     | Next.js. React.cache-deduped reads, `revalidateContent`, and `MdxBody` |
| [`@usegraft/sdk-astro`](packages/sdk-astro)                   | Astro. Typed reads plus `graftRoute` endpoint mounts                   |
| [`@usegraft/sdk-sveltekit`](packages/sdk-sveltekit)           | SvelteKit. Typed reads plus `graftRoute` for `+server.ts`              |
| [`@usegraft/sdk-tanstack-start`](packages/sdk-tanstack-start) | TanStack Start. Typed reads plus `graftRoute` for server routes        |
| [`@usegraft/sdk-react-router`](packages/sdk-react-router)     | React Router v7 framework mode. Typed reads plus loader/action mounts  |
| [`@usegraft/sdk-react`](packages/sdk-react)                   | The browser. Reads over HTTP, plus hooks                               |
| [`@usegraft/sdk-core`](packages/sdk-core)                     | Anything else. The typed client the others wrap                        |

Every adapter is typed structurally, so none of them depends on the framework it
adapts. `sdk-react` is the one that does not read a database: it reads a
[`@usegraft/content-api`](packages/content-api) endpoint over HTTP, because a
Postgres handle in a browser bundle is a database URL in a browser bundle.

## Telemetry

None. Graft collects no analytics, sends no usage pings, and phones home from no
command. The only network calls it makes are the ones your project configures:
your database, your asset store, and, when you use them, Neon's branching API
and your OIDC issuer.

## Packages

| Package                        | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `@usegraft/core`               | Schema (`defineCollection`), typed functions, access, the function runtime   |
| `@usegraft/compiler`           | Validate authored MDX and project it into the index                          |
| `@usegraft/db`                 | Postgres client, migrations, the static SQLite index, copy-on-write branches |
| `@usegraft/contracts`          | Error codes and introspection schemas every package shares                   |
| `@usegraft/sdk-core`           | Framework-agnostic typed read client and the cache-tag contract              |
| `@usegraft/content-api`        | Read-only HTTP transport for the authored-content index                      |
| `@usegraft/sdk-next`           | Next.js adapter                                                              |
| `@usegraft/sdk-astro`          | Astro adapter                                                                |
| `@usegraft/sdk-sveltekit`      | SvelteKit adapter                                                            |
| `@usegraft/sdk-tanstack-start` | TanStack Start adapter                                                       |
| `@usegraft/sdk-react-router`   | React Router v7 adapter, framework mode                                      |
| `@usegraft/sdk-react`          | Browser client and hooks over the content API                                |
| `@usegraft/cli`                | The `graft` command                                                          |
| `@usegraft/mcp`                | The agent surface: content, functions, introspection                         |
| `@usegraft/studio`             | The optional editing UI and approval queue                                   |
| `@usegraft/registry`           | The registry behind `graft add`                                              |
| `@usegraft/auth`               | OIDC verification, actor resolution, scope checks                            |
| `@usegraft/assets`             | S3-compatible storage and agent upload primitives                            |
| `@usegraft/mdx-safety`         | Refuses executable constructs in authored MDX                                |
| `@usegraft/content-migrations` | Codemod-style transforms for authored content                                |
| `@usegraft/tokens`             | The design tokens the Studio and examples share                              |

## Self-host

One image runs the whole backend: Postgres, MinIO, and `graft serve`.

```bash
docker run -p 3903:3903 -v "$PWD:/project" graft
```

It migrates, compiles, and serves, then logs a generated bearer token. Anonymous
MCP is never exposed. It serves under a hardened role wherever it owns its own
database. Adapters for Railway, Fly, a plain VPS, and Vercel live in
[`deploy/`](deploy/README.md).

## Documentation

- [Getting started](examples/docs-site/content/docs/getting-started.mdx)
- [The model](examples/docs-site/content/docs/the-model.mdx), and why content is code
- [The agent surface](examples/docs-site/content/docs/agent-surface.mdx)
- [Architecture decisions](docs/adr/), each stating the premise it rests on
- [Design notes](docs/design-notes/) from the de-risking spikes

## Status

Pre-1.0. Packages are published under `@usegraft/*`, and the API can still change
between minors when the change buys a better design. Every break is described in
the changelog and in the pull request that makes it.

## Contributing

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Engineering conventions live in
[`CONVENTIONS.md`](CONVENTIONS.md).

Report a vulnerability through [`SECURITY.md`](SECURITY.md), never a public
issue. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

MIT. See [`LICENSE`](LICENSE).
