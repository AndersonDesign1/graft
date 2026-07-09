# The registry & `graft add` (Phase 5 design)

Hand-off from the Phase 5 kickoff to the real `@graft/registry` + `graft add`
implementation. Locks the item format, the registry source, and — the load-bearing
call — **how an added primitive wires itself into a project**.

> Pairs with `PRD.md` §"Extensibility" / §"Registry governance" (the _what & why_)
> and `phases.md` Phase 5 (the _where we are_). This note is the _how_.

## What a primitive is

A **primitive** is a unit of **owned, copy-in code** an agent adds to a project and then
edits freely — the shadcn model, not the npm-dependency model. `graft add comments` copies
real source files into the repo; there is no `@graft/comments` black box to fight. This is
the moat: _owned primitives the agent rewrites_, which an incumbent can't adopt without
un-shipping its plugin system.

The example app already hand-builds the exact shape a primitive ships: `graft.config.ts`
has a db-authoritative `submissions` collection + a public mutation + a scope-gated query +
a human-gated destructive delete. A primitive is that cluster, packaged so `graft add`
drops it into _any_ project.

## Goals / non-goals

**Goals**

- One `graft add <item>` copies a primitive's files into the project as owned code.
- Adding a primitive that defines collections/functions is a **pure file-drop** — no manual
  wiring step for an agent to get wrong (the cold-agent path must stay dead-simple).
- Every item is **self-teaching**: it carries its own `llms.txt` fragment.
- The manifest is designed so a **remote HTTP registry** is a later drop-in, but Phase 5
  ships a **local, in-repo registry** only (deterministic, testable, matches the
  "no community registry until core is stable" governance).
- Items declare **semver compatibility with core** so a mismatch fails loudly.

**Non-goals (Phase 5)**

- No remote/community registry, no `--registry <url>`, no publish flow (format-compatible,
  built later).
- No dependency _resolution graph_ solver beyond a flat, ordered `registryDependencies`
  list (transitive, deduped; no version ranges between items yet).
- No uninstall/`graft remove` (owned code — you delete files and un-wire; revisit if pain).

## The manifest (a registry item)

Each item is a directory under `packages/registry/registry/<name>/` with a
`registry.item.json` manifest + the source files it ships. Manifest shape (validated by a
Zod schema in `@graft/registry`, so a malformed item is a `REGISTRY_ITEM_INVALID`, never a
half-written project):

```jsonc
{
  "name": "comments",
  "type": "bundle",                 // block | field | access | bundle
  "description": "Moderated comments: a db-authoritative collection + post/list/delete fns.",
  "graftVersion": ">=0.1.0 <0.2.0", // semver range checked against @graft/core
  "dependencies": {                  // npm deps to add to the target (if any)
    // "some-lib": "^1.0.0"
  },
  "registryDependencies": ["scoped-access"], // other items to add first (ordered, deduped)
  "files": [
    {
      "source": "graft/comments.ts",      // path inside the item dir
      "target": "graft/comments.ts",       // path inside the target project
      "role": "module"                     // module | component | content | env
    }
  ],
  "llms": "graft/comments.llms.txt"        // teaching fragment appended to project llms.txt
}
```

`target` paths are **conventional, not free-form** (see Wiring). `role` tells `add` where a
file belongs and whether it participates in auto-aggregation.

## Item types

| type     | what it ships                                   | typical target        |
| -------- | ----------------------------------------------- | --------------------- |
| `block`  | an MDX/React component (Callout, FAQ, Hero…)     | `components/`         |
| `field`  | a reusable `field.*` composition / field group   | `graft/fields/`       |
| `access` | an access-rule helper (a `requireScopes` preset) | `graft/access/`       |
| `bundle` | a collection + its functions + access, as a unit | `graft/<name>.ts`     |

`bundle` is the interesting one — it exercises config wiring, npm deps, `llms.txt`, and
access rules at once. Prove the mechanism against a bundle and `block`/`field` are trivial.

## Registry source — local-first

Phase 5's registry is **bundled inside `@graft/registry`** (`registry/<name>/…`), read from
disk (or from the built package). No network. The manifest already carries everything a
remote registry would serve as JSON, so "point `graft add` at a URL" is a later, additive
change — not a rewrite. Governance (PRD): Tier-1 primitives + the Tier-2 commerce foundation
ship here first; **no Tier-3 community registry until core is stable.**

## Wiring model — **DECIDED: directory auto-aggregation** (breaking)

The hard question: a `bundle` defines collections/functions that must reach the runtime, but
`graft.config.ts` is a single owned file. Three options:

1. **Print-the-line** — `add` writes `graft/comments.ts`, then _prints_ an import + spread
   for the human/agent to paste into `graft.config.ts`. Safe, but leaves a manual step the
   cold agent can fumble. ❌ (was the conservative default)
2. **AST codemod** — `add` parses `graft.config.ts` and inserts the import + export spread.
   Zero manual step, but edits the user's code with a fragile TS-AST rewrite. ❌
3. **Directory auto-aggregation via a generated barrel** — a generated `graft/index.ts`
   statically imports every `graft/<primitive>.ts` and re-exports the merged
   `collections`/`functions`; the root `graft.config.ts` imports that barrel once and
   spreads it. `add` writes the primitive file **and regenerates the barrel** — a pure
   file-drop from the author's view; nothing edits `graft.config.ts`. ✅ **chosen.**

**The decision:** `graft init` scaffolds a `graft.config.ts` that imports `./graft` (the
barrel) and spreads its `collections`/`functions` alongside the project's own, plus an
initial `graft/index.ts`. `graft add comments` writes `graft/comments.ts` (+ deps) and
**regenerates `graft/index.ts`**; the primitive is live on the next `graft compile` with
**zero edits to `graft.config.ts`**. The barrel calls `mergePrimitives()` (new, in
`@graft/core`), which throws **`CONFIG_INVALID`** on a duplicate `collections`/`functions`
key across modules — deterministic, greppable. Load order is alphabetical by filename.

_Why a generated barrel, not a load-time glob:_ the first draft had the config **loader**
globbing `graft/**/*.ts` at load time. That works for the CLI (jiti/Node) but **not for the
Next runtime**, which imports `graft.config.ts` **statically** — a webpack/Turbopack bundle
can't include modules discovered by a runtime glob. A generated barrel is statically
analyzable, so the **same merged config serves both the CLI and the app** through one
mechanism. The barrel is generated infra (a `routeTree.gen.ts`-style artifact, header-marked
"do not edit") — owned and greppable, never hand-edited.

This is a **BREAKING change** to what `graft init` scaffolds and to the example's single-file
config (both migrate to "root config + `graft/` barrel"). That's the correct long-run shape
for an agent-first CMS — a Next.js-`app/`-style file convention agents handle natively — and
pre-1.0 is exactly when to make it. `loadConfig` (CLI) is otherwise unchanged: it still reads
the already-merged `collections` the config exports.

## `graft add` behaviour

Resolve → plan → write:

1. **Resolve** the item + its `registryDependencies` (transitive, deduped, dependency-first
   order). Unknown name → `REGISTRY_ITEM_NOT_FOUND` (fix lists available items).
2. **Version-check** each item's `graftVersion` against the installed `@graft/core`. Mismatch
   → `REGISTRY_ITEM_INVALID` (fix: which version the item needs).
3. **Plan** the file writes to their conventional targets. An existing target file →
   `REGISTRY_FILE_EXISTS` **unless `--overwrite`** (the only guard — everything else is
   additive). `--dry-run` prints the plan and stops.
4. **Write** the files, add any npm `dependencies` (print the install line; don't shell out),
   append the `llms` fragment to the project `llms.txt`, and print exactly what landed +
   the one-line "it's live on next `graft compile`" confirmation.

`add` **writes by default** (unlike `migrate`/`merge`, which are dry-run-default). Rationale:
`migrate`/`merge` touch the DB / prod and are gated for that reason; `add` only creates new
files in a git-tracked tree — reversible, so the `REGISTRY_FILE_EXISTS` guard + `--dry-run`
are enough. Keeping the common path a single no-flag command matters for agents.

## Error codes (new, in `@graft/contracts`)

- `REGISTRY_ITEM_NOT_FOUND` — unknown item name; fix lists what's available.
- `REGISTRY_ITEM_INVALID` — malformed manifest **or** `graftVersion` mismatch; fix names the
  problem.
- `REGISTRY_FILE_EXISTS` — a target file already exists; fix: re-run with `--overwrite` or
  remove the file.

Each ships an `explain_error` entry (the `@graft/mcp` knowledge base is test-enforced to
cover every code).

## Self-teaching

Every item carries an `llms.txt` fragment that `add` appends to the project's `llms.txt`, so
the next agent to open the repo learns the primitive the same way it learns the rest of
Graft. Reserved for **P6**: MCP `list_registry` / `search_registry` / `describe_item` so an
agent can browse and add primitives without leaving the protocol. The manifest is the
introspection source those tools will read — design them off it, don't invent a second shape.

## First primitive (the P5.1 target): `comments` bundle

A moderated-comments `bundle`, deliberately the shape the example already proves by hand:

- `graft/comments.ts` — `comments` collection (`db-authoritative`: `author`, `body`,
  `pageSlug`, `approved`) + `postComment` (public mutation, rate-limited) + `listComments`
  (public; approved only) + `moderateComment` (scope-gated) + `deleteComment` (destructive,
  human-gated). Exports `collections` + `functions` maps for the loader to merge.
- `graft/comments.llms.txt` — how to author, moderate, and query comments.
- `registryDependencies: ["scoped-access"]` — a tiny `access` item (a `requireScopes`
  preset) added first, to exercise transitive resolution.

Proof (P5.1 exit): in `examples/landing-page`, `graft add comments` → `graft compile` picks
up the merged collection/functions with **zero config edits** → post/list/moderate/delete
work live against Neon → the browser shows comments. Then commerce (P5.2+) is just more
bundles on the same rails.

## Build sequence

- **P5.0** — this note (lock the format + wiring). _(current)_
- **P5.1** — `@graft/registry` (manifest Zod + bundled registry + pure `resolveItem`/`planAdd`
  + writer) · loader directory-aggregation (the breaking change) + `graft init` scaffolds the
  `graft/` convention · `graft add` real · the `comments` + `scoped-access` items · contracts
  codes + explain entries · unit tests + one integration proof in the example.
- **P5.2** — real MDX bodies (`MdxBody` in `@graft/sdk-next`; generated
  `components/mdx-components.ts` map parallel to the graft/ barrel) · `field.object` /
  `field.array` · Tier-1 `seo` / `callout` / `faq` · Tier-2 `commerce` (products files +
  orders Postgres). Pre-1.0: prefer better long-run design over compatibility; competitive
  bar is Basehub / Sanity / WordPress / Prismic / Contentful / Strapi / Payload.

## Open questions

- **Merge vs descriptor** for aggregation (map-merge vs `definePrimitive()`), and load order
  determinism — settle in P5.1 against real code.
- **`env` role**: some bundles need env vars (e.g. a scope name). For now `add` prints them;
  a managed `.env.example` merge is deferred.
- **npm install**: `add` prints the install line rather than shelling out to a package
  manager (which one? monorepo vs app). Revisit if the manual step bites.
- **Uninstall**: no `graft remove` yet — owned code is deleted by hand. Add if it hurts.
