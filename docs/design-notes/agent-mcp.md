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
  tokens from trusted issuers (`@graft/auth`).
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
`@graft/contracts` (`RegistryItemDescriptor`), with a drift test keeping
registry's authoring enums (`ITEM_TYPES` / `FILE_ROLES`) in lockstep.

### Still later

- Dedicated asset tools (today: CLI `graft asset put` + frontmatter)
- Delete-content tool (destructive gate)
- HTTP-only cold-agent CI (remote transport of the P6.1 path)

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
| `@graft/auth`   | Verify JWT / map dev tokens → `FunctionActor` + scopes |
| Functions / MCP | Enforce `access`, scopes, public, destructive gate     |
| Humans          | `graft approvals` / `approve` / `deny` for gated ops   |

Graft never becomes the identity provider of record.

## Phasing

| Unit        | Deliverable                                                                            |
| ----------- | -------------------------------------------------------------------------------------- |
| **P6.1** ✅ | Cold-agent MCP unit path + CI (`pnpm test:cold-agent`)                                 |
| **P6.2** ✅ | Function tools + `describe_schema.functions` + `graft mcp` + docs                      |
| **P6.3** ✅ | Registry MCP browse (`list_registry` / `describe_item`) + introspection contract tests |
| **P6.4+**   | Remote HTTP cold-agent; asset/delete tools; remaining ergonomics                       |

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
- [x] `describe_item` returns a `RegistryItemDescriptor` (from `@graft/contracts`); no absolute `dir` leaks.
- [x] `describe_item` fails closed on unknown items — `REGISTRY_ITEM_NOT_FOUND` with the available list + `fix`.
- [x] Introspection contract tests: `describe_schema` / `describe_function` / `describe_item` / `list_registry` outputs validate against the published Zod schemas (recursive object/array fields + function flags covered).
- [x] Vocabulary drift guard: registry `ITEM_TYPES` / `FILE_ROLES` stay in lockstep with the contracts enums.
- [x] `llms.txt` / README / design note teach the browse tools.

## Open questions (not blocking P6.2)

1. Should stdio MCP auto-load a project-local `graft.actor.ts` resolver, or keep
   env-only tokens in the CLI and full resolvers only in app HTTP routes?
2. When do we promote example `.mcp.json` from `pnpm … mcp` to `graft mcp` only?
3. Dynamic MCP tool-per-function (Convex-style one tool per fn) vs stable three
   meta-tools — prefer **meta-tools** until the function count forces a split
   (tool-list bloat vs discoverability).
