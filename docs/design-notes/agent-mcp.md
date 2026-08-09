# Agent MCP surface (Phase 6 design)

Hand-off from competitive research (Sanity / Convex / Railway / Better Auth) to
the **project MCP** work in Phase 6. Locks what Graft's agent surface is, what it
is not, and how tools stay safe.

> Pairs with `PRD.md` (agent-first operator model), `phases.md` Phase 6, and
> `docs/design-notes/registry.md` (owned primitives the agent can add). This note
> is the **how agents talk to a Graft project**.

## The product bar

Agents should operate a Graft project the way they operate a well-instrumented
backend:

| Pattern (inspiration)  | What Graft copies                                                                                                                                                    | What Graft does **not** copy                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Convex** live tools  | Discover + invoke typed server logic (`list_functions` / `describe_function` / `run_function`) over the same access, audit, rate-limit, and human-gate rules as HTTP | Convex as a host; Graft stays on owned Postgres                   |
| **Railway** install UX | One command / one config entry: `graft mcp` + `.mcp.json` stdio; optional remote HTTP                                                                                | Platform account OAuth as a required core path                    |
| **Sanity MCP**         | Rich content tools when they match our model (schema, documents, search)                                                                                             | Studio-centric mutations, cloud project admin as the primary loop |
| **Better Auth**        | Example **issuer** only — Graft **verifies** JWTs / dev tokens                                                                                                       | Minting identity inside Graft; Agent Auth capability bus as core  |

**Moat:** git-authoritative content + owned primitives + compile-time teaching
(`describe_schema`, `explain_error`, GraftError `fix`) — not "another MCP
wrapper around a dashboard CMS."

## Goals / non-goals

### Goals

1. **Project MCP is the default agent surface.** Opening a Graft repo (or
   running `graft mcp` in a project) exposes content + schema + functions for
   _that_ project — not a multi-tenant cloud console.
2. **One invoke path.** `run_function` reuses `createFunctionsHandler` so MCP and
   `POST /api/fn/<name>` cannot diverge on auth, validation, audit, rate limits,
   or destructive approvals.
3. **Self-teaching.** Cold agents learn from tools + `llms.txt` + error `fix`
   fields without reading `phases.md` or private trackers.
4. **Install is boring.** Stdio via CLI (or example `pnpm mcp`); remote agents
   use the existing Streamable HTTP handler. Optional bearer auth on HTTP.
5. **Safety by default.** Mutations reject anonymous unless `public: true`;
   destructive ops always require one-shot human approval; content writes land
   as files (git) after schema validation.

### Non-goals (do not build as core)

- **Agent Auth / capability-token bus** as a Graft product surface. Interesting
  research; not required for agents to edit content or call functions today.
- **Graft as an OAuth provider.** Hosts may add OAuth later; Graft verifies
  tokens from trusted issuers (`@usegraft/auth`).
- **Better Auth plugins as Graft plugins.** Better Auth stays an example issuer
  in the landing-page app. No "Graft Auth MCP plugin" dependency in core.
- **Cloud project admin tools** (create org, bill, deploy studio) as first-class
  MCP — those are host concerns, not CMS-core concerns.
- **Bypassing the function boundary** for db-authoritative data. Data search and
  mutations stay behind typed functions (already enforced for FTS / records).

## Two transports, one server

```
createGraftMcp(options)  →  McpServer (tools)
        │
        ├── serveStdio(server)              # local agents, .mcp.json, `graft mcp`
        └── createGraftMcpHandler(options)  # remote agents, POST /api/mcp
```

|        | Stdio (`graft mcp`)                                                                          | HTTP (`createGraftMcpHandler`)                                                                      |
| ------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Who    | IDE agents, CLI agents, local CI                                                             | Hosted / eve agents                                                                                 |
| Auth   | `GRAFT_DEV_TOKEN` is the server's default identity (secret never enters the agent's context) | `actor` resolver; optional `requireActor`; the connection's bearer is forwarded into `run_function` |
| Writes | Writable checkout                                                                            | Same (dev/self-host tree)                                                                           |
| Config | Loads `graft.config.ts` from cwd                                                             | App wires collections/functions                                                                     |

## Tool surface (target)

### Content + schema (shipped)

| Tool                           | Role                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| `list_collections`             | Names, authority, field counts                                     |
| `describe_schema`              | Full collections **and** functions (contracts `SchemaDescription`) |
| `list_content` / `get_content` | File-authoritative reads (git truth)                               |
| `search_content`               | FTS on compiled index; hits carry `sourcePath`                     |
| `write_content`                | Validate → write MDX → compile (one call)                          |
| `explain_error`                | Knowledge base for every `ErrorCode`                               |

### Functions (P6.2)

| Tool                | Role                                                     |
| ------------------- | -------------------------------------------------------- |
| `list_functions`    | Name, kind, public/destructive flags, short description  |
| `describe_function` | Full `FunctionDescriptor` (args, returns, flags)         |
| `run_function`      | Invoke via `createFunctionsHandler` — same gates as HTTP |

`run_function` inputs:

- `name` — function name (the defineFunction `name`, not the export key)
- `input` — JSON object of field inputs (default `{}`)
- `authorization` — optional bearer override (or raw token; server prefixes `Bearer `)
- `approval` — optional approval id (`x-graft-approval`) for human-gated calls

**Credentials stay out of the agent's context.** A server-held
`defaultAuthorization` applies when the tool call passes no `authorization`:
`graft mcp` sets it from `GRAFT_DEV_TOKEN` (anyone who can spawn the process
can already read `.env`, so this grants nothing new), and
`createGraftMcpHandler` forwards the incoming request's own `Authorization`
header per request. Agents therefore act as themselves without echoing tokens
into tool arguments, transcripts, or MCP client logs; an explicit
`authorization` argument still overrides for acting-as scenarios.

### Registry browse (P6.3) ✅

| Tool            | Role                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `list_registry` | Every owned primitive available to `graft add` (name, type, one-line description, deps it pulls in)         |
| `describe_item` | Full `RegistryItemDescriptor` for one item (files it writes, npm deps, transitive registry deps, llms flag) |

CLI `graft add` remains the install path; MCP teaches _what exists_. Descriptors
drop the machine-specific absolute `dir`; the introspection shape lives in
`@usegraft/contracts` (`RegistryItemDescriptor`), with a drift test keeping
registry's authoring enums (`ITEM_TYPES` / `FILE_ROLES`) in lockstep.

### Content ops + assets (P6.5) ✅

| Tool             | Role                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delete_content` | Remove an authored MDX file + recompile (index soft-deletes). Destructive → always human-gated                                                                            |
| `put_asset`      | Upload a binary + return the `asset`-field frontmatter reference. `path` (stdio, server-local file) or `base64` + `key` (remote); `ASSET_EXISTS` unless `overwrite: true` |

`delete_content` is an **internal destructive `defineFunction` served by its own
`createFunctionsHandler` instance** — never merged into the project's functions
(no name collisions, absent from `list_functions`), but riding the exact P3.4
pipeline: first call files a one-shot, input-bound approval and fails with the
id (`DESTRUCTIVE_OP_REQUIRES_APPROVAL`); after `graft approve <id>` the retry
passes `approval: <id>` (the MCP form of the `x-graft-approval` header). The
function is `public` because the human approval IS the gate — requiring a
bearer as well would brick anonymous local stdio servers without adding
control. The tool pre-checks collection/authority/existence so a human never
reviews an approval for a document that doesn't exist; the handler re-resolves
at execution time. Audit rows + rate limits apply as for `run_function`.

`put_asset` refuses to clobber an existing key without explicit
`overwrite: true` (new `ASSET_EXISTS` code) because the object store keeps no
version history — unlike content, an overwritten binary is unrecoverable. Key
sanitization + content-type inference live in `@usegraft/assets`
(`defaultKeyFor` / `contentTypeFor`), shared with `graft asset put`.

### Still later

- HTTP-only live off-repo cold-agent exercise (needs a running app + writable tree)

## `graft mcp` (CLI install)

```bash
# From a project with graft.config.ts + DATABASE_URL
graft mcp
graft mcp --branch preview/foo
```

Behavior:

1. Discover and load `graft.config.ts` (collections **required**, functions
   **optional**).
2. Connect `DATABASE_URL` (same env rules as `graft compile`).
3. Build `createGraftMcp` with collections + functions + optional actor from
   `GRAFT_DEV_TOKEN` / `GRAFT_DEV_SCOPES` (verify-don't-mint; no Better Auth in CLI).
4. `serveStdio` until the client disconnects.

`.mcp.json` example (any Graft project):

```json
{
  "mcpServers": {
    "graft": {
      "command": "pnpm",
      "args": ["exec", "graft", "mcp"]
    }
  }
}
```

The monorepo example may keep `pnpm --filter landing-page mcp` until the CLI path
is the documented default.

## Safety defaults (locked)

1. **Content writes** only for `file-authoritative` collections; db-authoritative
   → `AUTHORITY_MISMATCH` pointing at functions.
2. **Mutations** reject `anonymous` unless `public: true` or a custom `access`
   rule allows them.
3. **`destructive: true`** always requires a pending → approved → one-shot
   consume approval (`graft approve`), including when called via MCP.
4. **Rate limits** and **audit_log** apply to `run_function` exactly as HTTP
   (unless the host disables audit for a test harness).
5. **No silent auth downgrade** — bad bearer → `TOKEN_INVALID`, not anonymous.
6. **MCP HTTP** may set `requireActor` for any network-exposed endpoint.

## Auth model (reminder)

| Layer           | Responsibility                                         |
| --------------- | ------------------------------------------------------ |
| App / host      | Mint tokens (Better Auth example, company IdP, etc.)   |
| `@usegraft/auth`   | Verify JWT / map dev tokens → `FunctionActor` + scopes |
| Functions / MCP | Enforce `access`, scopes, public, destructive gate     |
| Humans          | `graft approvals` / `approve` / `deny` for gated ops   |

Graft never becomes the identity provider of record.

## Phasing

| Unit         | Deliverable                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **P6.1** ✅  | Cold-agent MCP unit path + CI (`pnpm test:cold-agent`)                                         |
| **P6.2** ✅  | Function tools + `describe_schema.functions` + `graft mcp` + docs                              |
| **P6.3** ✅  | Registry MCP browse (`list_registry` / `describe_item`) + introspection contract tests         |
| **P6.4** ✅  | Remote HTTP cold-agent CI gate (`cold-agent-http.test.ts`)                                     |
| **P6.5** ✅  | `delete_content` (destructive gate over MCP) + `put_asset` tools                               |
| **P6.5+** ✅ | Live off-repo cold-agent exercise passed (2026-07-10) + ergonomics fixes from its friction log |

## Acceptance (P6.2)

- [x] `describe_schema` includes real `functions[]` from config (not always `[]`).
- [x] `list_functions` / `describe_function` / `run_function` registered on stdio + HTTP.
- [x] `run_function` fails closed: unknown name, bad input, anonymous mutation — GraftError JSON with `fix` (destructive gate covered by the shared handler suite).
- [x] Public query / public mutation succeed via MCP with empty input (unit).
- [x] `graft mcp` CLI command loads project config + functions + stdio serve.
- [x] Unit tests cover function tools offline; live invoke stays on app HTTP / integration.
- [x] `llms.txt` / README / design note teach the tools.

## Acceptance (P6.3)

- [x] `list_registry` / `describe_item` registered on stdio + HTTP (same server → both transports).
- [x] `describe_item` returns a `RegistryItemDescriptor` (from `@usegraft/contracts`); no absolute `dir` leaks.
- [x] `describe_item` fails closed on unknown items — `REGISTRY_ITEM_NOT_FOUND` with the available list + `fix`.
- [x] Introspection contract tests: `describe_schema` / `describe_function` / `describe_item` / `list_registry` outputs validate against the published Zod schemas (recursive object/array fields + function flags covered).
- [x] Vocabulary drift guard: registry `ITEM_TYPES` / `FILE_ROLES` stay in lockstep with the contracts enums.
- [x] `llms.txt` / README / design note teach the browse tools.

## Acceptance (P6.4)

- [x] The whole cold path runs over the Streamable HTTP wire (`createGraftMcpHandler` + a real MCP client), not an in-process transport: discover → failed write → `explain_error` → schema-derived write → read back.
- [x] The endpoint requires an actor and the very first anonymous connect fails with a 401 whose message teaches the fix (`Authorization: Bearer …`) — the error is the only teacher a remote agent has.
- [x] A gated typed function is invoked with the **connection's** bearer only — no token in tool arguments (the P6.3-followup forwarding path, gated in CI).
- [x] Registry browse works over the wire.
- [x] Runs offline under `pnpm test:cold-agent` (projection stubbed) — CI-blocking alongside the P6.1 file.
- [x] Live off-repo agent exercise (fresh agent, running app, network HTTP, no repo checkout) — passed 2026-07-10; see Acceptance (P6.5 — live half).

## Acceptance (P6.5 — tools half)

- [x] `delete_content` registered on stdio + HTTP; removes the file, recompiles, returns the ChangeSet + correlationId.
- [x] The destructive gate holds over MCP: no approval → `DESTRUCTIVE_OP_REQUIRES_APPROVAL` with the id; denied → `APPROVAL_INVALID` (denied); consumed ids are one-shot (already_consumed); approvals bind to the exact collection+slug (mismatch).
- [x] No approval is filed for a missing document or a db-authoritative collection (fail-fast before the human is bothered).
- [x] The internal delete function never appears in `list_functions` / `describe_schema.functions`.
- [x] `put_asset` uploads via `path` (server-local) and `base64` + `key` (remote); content type inferred; key validated against the asset-key alphabet; response carries key/bytes/url/frontmatter snippet.
- [x] Existing keys refuse without `overwrite: true` — `ASSET_EXISTS` (+ explain entry; the knowledge base stays in lockstep with ErrorCodes by type).
- [x] All offline: in-memory approval store, fake storage, stubbed projection (`content-ops.test.ts`).
- [x] `llms.txt` / design note teach both tools.
- [x] Live off-repo agent exercise — passed, next section.

## Acceptance (P6.5 — live half) ✅ 2026-07-10

The banked "fully cold" gate ran for real: a fresh agent with **no repo checkout
and no llms.txt** — MCP tool descriptions, schemas, and error messages were its
only teachers — drove the running example app over network Streamable HTTP
(`POST /api/mcp`, `GRAFT_MCP_REQUIRE_AUTH=1`, bearer token as its sole context).

- [x] Cold discovery: 4 calls from zero to fully oriented (tools → collections → schema → content).
- [x] Authored `pages/changelog` end-to-end: hand-wrote an SVG, uploaded via `put_asset` (base64 + key; key convention inferred from existing docs), referenced it as `{ key, alt }`, verified via `get_content` **and** a rendered HTTP 200 with the R2-hosted hero loaded.
- [x] Destructive gate over the network, both halves: `delete_content` filed the approval and refused; a human ran `graft approve`; the one-shot retry (the `approval` tool argument) deleted the file and recompiled (`removed: ["pages/delete-me-test"]`); `GET /delete-me-test` → 404. A replay of the same approval id was refused (the existence pre-check fires before approval consumption — by design, and no new approval was filed).
- [x] **Zero unintended tool-call failures across both runs** — the only errors were the mandated gate refusal and the deletion proofs.
- [x] Friction log → ergonomics fixes (`2bfd3f7`): `describe_schema` now teaches asset fields (`{ key, alt? }` + `put_asset`, recursive through object/array); approval errors are translated to MCP-speak (`approval` argument, never `x-graft-approval`) at the `invokeFunction` boundary; `write_content`/`delete_content` say who owns the git commit (the checkout's operator — remote callers can't and needn't).
- Declined (minor, from the log): encoding `put_asset`'s path-XOR-(base64+key) rule as JSON-Schema `oneOf` — the prose taught the cold agent on the first try.

## Open questions (not blocking P6.2)

1. Should stdio MCP auto-load a project-local `graft.actor.ts` resolver, or keep
   env-only tokens in the CLI and full resolvers only in app HTTP routes?
2. When do we promote example `.mcp.json` from `pnpm … mcp` to `graft mcp` only?
3. Dynamic MCP tool-per-function (Convex-style one tool per fn) vs stable three
   meta-tools — prefer **meta-tools** until the function count forces a split
   (tool-list bloat vs discoverability).
