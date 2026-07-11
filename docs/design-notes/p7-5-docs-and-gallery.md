# P7.5 — Docs site + "why Graft" page + example gallery (Phase 7 close-out)

**Status: PLANNED (2026-07-11); operator decisions locked below.** The last
Phase 7 unit. After this ships, Phase 7 closes and the packaging / deploy /
framework story is end-to-end. Everything runtime-side already exists; P7.5 is
the **public-facing surface** over it — no new invariants, no new `@graft/*`
runtime packages.

Pairs with `packaging.md` (which parks "docs site" as the remaining item).

## Operator decisions (2026-07-11)

1. **No competitor comparison.** Do **not** name or table competitors. Sell the
   product on its own benefits and on *how Graft is different* — not "better than
   X." The old "compare page" is replaced by a **"Why Graft" / product story**
   page framed entirely around what it does and how it feels.
2. **Stack: Astro + React, using Graft.** Both the landing page and the docs are
   one Astro app with React islands where interactivity is warranted, reading its
   own content through Graft (`@graft/sdk-astro`). Dogfood, not a static brochure.
3. **Deploy target: Vercel** (for now). Build for Vercel's Astro adapter. The
   whole point is portability — migrating later is cheap, so don't over-abstract
   the host now.
4. **Design bar: no defaults, ever.** The landing must speak taste — animated
   SVGs, peculiar sections where peculiarity earns its keep, zero generic
   AI-slop layout. Bento grids whose cells embed **live product UI** (the studio
   cell contains actual studio elements), not screenshots. Design skills in
   force: `emil-design-eng`, `make-interfaces-feel-better`, `apple-design`,
   `animation-vocabulary` (+ Emil's review skills for polish passes).
5. **Build order: docs shell → studio elements → landing.** The docs force the
   design system into existence against real content; `@graft/studio` starts as
   an **embeddable React component library** (approval queue, branch diff,
   content tree, compilation trail — wired to real reads), *not* a full app;
   the landing then assembles the matured system and embeds those live
   components in its bento cells. Nothing faked, nothing throwaway — the future
   studio app composes the same components.

---

## What this unit is (and is not)

**Is:** a self-hostable Astro+React site (landing + docs) plus runnable example
apps that prove the SDK matrix (Next / Astro / SvelteKit) against a real Graft
runtime.

**Is not:** an admin UI. `@graft/studio` stays a placeholder (we win by *not*
cloning dashboards). No competitor benchmarking. Nothing here becomes a required
runtime dependency — the site is a leaf app, not a package others import.

**Three deliverables, one unit:**

1. **Landing + docs site** — Astro + React, reads itself via Graft.
2. **"Why Graft" page** — the product story: benefits + what makes it different,
   no competitors.
3. **Example gallery** — Next (exists) + **Astro** + **SvelteKit** example apps
   (the P7.4 follow-ups, phases.md:356–357), showcased from one place.

---

## Stack & location (locked)

**Astro app + React islands** at `examples/docs-site/` (workspace already globs
`examples/*`). The site reads its own content through `@graft/sdk-astro` +
`graftRoute`, so building it **closes the P7.4 "Astro example app" gap** in the
same breath — one app earns two checkboxes. React is used for the interactive
bits (nav, code-tabs, any live demo island); Astro carries the static shell.

**SvelteKit** gets a *separate* minimal app (`examples/gallery-sveltekit/`) so
each framework SDK has exactly one runnable proof. The gallery links to all
three; it is not folded into the docs host.

### Proposed layout

```
examples/
  landing-page/          # existing — the Next reference (SDK: sdk-next)
  docs-site/             # NEW — Astro + React; landing + docs + why + gallery index
    src/content/docs/    # authored MDX docs (git-native — dogfoods the model)
    src/components/      # React islands (nav, code tabs, demo bits)
    src/pages/
      index.astro            # landing / what-is-Graft
      why.astro              # "Why Graft" product story (no competitors)
      gallery.astro          # example gallery index
      docs/[...slug].astro   # docs renderer
    graft.config.ts          # tiny Graft project so the site reads itself via sdk-astro
    astro.config.mjs         # @astrojs/react + @astrojs/vercel adapter
  gallery-sveltekit/     # NEW — minimal SvelteKit app proving sdk-sveltekit
```

Docs *content* is authored MDX compiled by `@graft/compiler` and read back
through `sdk-astro` where it earns the round-trip; prose that genuinely doesn't
need the DB may use Astro content collections directly. Dogfood where it's
honest, not performative.

---

## The "Why Graft" page (replaces the compare page)

Frame the whole page around **what Graft does and how it feels**, never around
another product. Organize by the four things that actually define it:

- **Agents are first-class operators.** MCP tools, the cold-agent CI gate,
  `llms.txt` — an agent can author, deploy, and be safely gated. Show the loop,
  not a rivalry.
- **Git is the source of truth.** Authored content is MDX in the repo with real
  history; Postgres is a derived, rebuildable index. Explain the "git wins →
  recompile" invariant as a *feature*: no lock-in, no opaque content tree.
- **Copy-on-write preview branches.** `graft branch`/`merge`, overlay + neon
  backends — real previews without cloning prod data. Link `branching.md`.
- **You own your primitives.** `graft add` copies components into your repo
  (shadcn-style) — no plugin security surface, no hosted black box. Link
  `registry.md`.

Plus the portability story the operator called out: **"deploy anywhere, migrate
cheaply"** — embedded or `graft serve`, Vercel today, container tomorrow, same
bytes (`packaging.md`). That *is* a differentiator stated as a benefit.

Rules: every capability claim links to the primitive/doc that backs it (receipts,
so the page can't drift from reality). No feature-matrix, no logos, no "vs."

---

## Example gallery

Index page cards each runnable example: framework, SDK package, features it
exercises, "run it" instructions, screenshot/live link.

| Example | SDK | Proves |
| --- | --- | --- |
| `landing-page` | `@graft/sdk-next` | RSC reads, MdxBody, revalidate webhook, functions, MCP route |
| `docs-site` | `@graft/sdk-astro` | typed reads (no memo) + `graftRoute` endpoint mount, React islands |
| `gallery-sveltekit` | `@graft/sdk-sveltekit` | typed reads + `graftRoute` `+server.ts` mount |

Each example must **actually boot** against a Graft runtime — no faked
screenshots. The gallery is the visual proof that identical-bytes packaging holds
across three frameworks.

---

## Docs site — page inventory (proposed)

Grounded in what already exists, so writing = surfacing, not inventing:

- **Getting started** — `graft init` → `compile` → `dev` (`@graft/cli`).
- **The model** — git authoritative, Postgres derived index, one Zod layer.
- **Reading content** — sdk-core → sdk-next/astro/sveltekit; cache-tag contract.
- **Functions & access** — `defineFunction`, stateless-handler invariant, access
  defaults, audit, rate limits, approvals (P3).
- **Branching & previews** — overlay vs neon; `graft branch`/`merge`.
- **Owned primitives** — `graft add`, the registry.
- **The agent surface** — MCP tools, cold-agent gate, `llms.txt`.
- **Deploy** — pull straight from `deploy/*.md` + `graft serve`/`graft harden`.
  Link, don't duplicate.
- **CLI reference** + **SDK reference** (the four SDK packages).

Assembly from existing `deploy/*.md`, `design-notes/*`, `llms.txt`, and package
READMEs — the risk is drift, so prefer links/transclusion over copy-paste.

---

## Deploy (Vercel, locked)

- `@astrojs/vercel` adapter; static-first with server islands/endpoints where the
  `graftRoute` mount and any live reads need a runtime.
- Env contract identical to what the example app already teaches
  (`DATABASE_URL`, dev token/scopes, etc.) — the Vercel adapter path in
  `deploy/vercel.md` already documents the shape; the docs site is its first real
  consumer.
- Don't over-abstract the host: one adapter, one target. Portability is a runtime
  property we already have, not something the docs site needs to re-prove in its
  build config.

---

## Scope guardrails (don't gold-plate)

- No admin UI, no auth-walled dashboards, no competitor benchmarking.
- Reuse FTS if search is wanted; don't build a new search backend.
- SvelteKit example is intentionally minimal — one page proving the mount.

---

## Execution order (locked — decision 5)

1. **Scaffold + design foundation** — `examples/docs-site` Astro + React +
   Vercel adapter + `graftRoute` mount + tiny graft project (closes the Astro
   example gap). Design tokens, type scale, color, motion vocabulary defined
   here, once.
2. **Docs shell + pages** — nav, code blocks, tables, callouts, MDX map; docs
   content assembled from existing sources. This matures the design system
   against real content before any marketing pixel is drawn.
3. **Studio elements** — `@graft/studio` becomes an embeddable React component
   library: ApprovalQueue, BranchDiff, ContentTree, CompilationTrail — wired to
   real sdk reads. Scope-guard: components only, no studio app shell/routing.
4. **Landing + "Why Graft"** — the bento assembles live studio components as
   islands; animated SVGs; benefits-only story with receipts wired.
5. **`examples/gallery-sveltekit`** minimal app (closes SvelteKit example gap).
6. **Gallery index** linking all three; boot-check each example.
7. Polish pass with Emil's review skills; update `packaging.md` status +
   `phases.md` (tick P7.5, **close Phase 7**).

---

## Field notes — competitor landings (design research, 2026-07-11)

Browsed live for inspiration only — **nothing competitor-facing ships** (decision 1).

### Sanity (sanity.io — live read)

- **Type does the talking:** custom grotesque (Waldenburg) at ~96px, weight 400,
  very tight tracking (−4%). Big-type-light-weight reads expensive; no gradient-
  text slop anywhere.
- **Palette:** white / near-black `#0b0b0b`, cool gray borders, then *soft*
  pastel accents (powder blue, coral, lavender) + one display-P3 lime for punch.
  Pill buttons (`border-radius: 9999px`).
- **The big move — they embed real product UI in the landing:** "CLICK TO
  INTERACT" panels containing an actual schema editor, studio pane, history
  view, release manager, and two live chat bots. Validates our bento-with-live-
  studio-elements plan; ours must go further (theirs are staged sandboxes — ours
  read real data through the sdk).
- Numbered section pills (01 CONTENT-AS-DATA … 05 POWER ANY APPLICATION);
  trigger→function→output pipeline visualization; heavy use of real code with
  file-tab chrome (`hero.ts` / `terminal`).
- Positioning: "The Content Operating System for the AI era" — they are racing
  to the same agent story. Our landing must out-credibility them: they *narrate*
  agent ops; we can *demonstrate* them (MCP + cold-agent gate are real).

### Basehub (basehub.com — live read)

- **Market signal: "BaseHub Is Joining Vercel"** (banner, verbatim). The
  agent-native CMS space is consolidating; independence + self-host is now a
  *differentiator we hold*.
- **Dark, quiet, engineered:** near-black bg, gray text hierarchy, Geist, h1
  only 48px/500 (understated), one signature accent — orange `#ff6c02`. Pill
  buttons. 20 inline SVGs, zero canvas — light and fast.
- **Letter-flip marquee** of feature names (each glyph duplicated for a
  roll-over animation) — a good example of "peculiar but earning its keep."
- Framework tabs on the hero code block (**Next.js / Astro / SvelteKit** — the
  exact matrix we ship); branching told as a 3-step numbered story ("Branch out
  → Review → Merge to main"); Notion-feel editor pitch; template gallery as
  cards.

### Payload (payloadcms.com — **unreachable from this environment**; notes from
memory, verify before borrowing)

Historically: brutalist black/white technical aesthetic, crosshair/registration
marks, mono accents, "code-first" positioning. Treat as unverified.

### What we take / what we refuse

- **Take:** live product UI embedded in marketing (Sanity — but ours reads real
  data); framework-tabbed code blocks (Basehub — our exact SDK matrix); one
  disciplined accent color + restrained type scale; peculiar micro-moments like
  the letter-flip marquee; numbered narrative for branching.
- **Refuse:** staged/sandboxed demos pretending to be product; "AI era" slogan
  inflation without receipts; both use pill buttons + tight-tracked grotesques —
  a chance to differentiate silhouette (e.g. squared geometry, different type
  contrast) so Graft doesn't read as another entry in the same template.
- **Whitespace positioning gap:** Sanity sells to content-ops teams, Basehub
  sold to Vercel. Nobody owns "the CMS whose primary operator is an agent, that
  you fully own and can move anywhere." That's the story the hero tells.

## Remaining open questions

None. Landing + docs live in **one Astro app** (operator: "keep", 2026-07-11).
All decisions locked; execution can start at step 1.
