# P7.5 — Docs site + "why Graft" page + example gallery (Phase 7 close-out)

**Status: PLANNED (2026-07-11); operator decisions locked below.** The last
Phase 7 unit. After this ships, Phase 7 closes and the packaging / deploy /
framework story is end-to-end. Everything runtime-side already exists; P7.5 is
the **public-facing surface** over it — no new invariants, no new `@usegraft/*`
runtime packages.

Pairs with `packaging.md` (which parks "docs site" as the remaining item).

## Operator decisions (2026-07-11)

1. **No competitor comparison.** Do **not** name or table competitors. Sell the
   product on its own benefits and on _how Graft is different_ — not "better than
   X." The old "compare page" is replaced by a **"Why Graft" / product story**
   page framed entirely around what it does and how it feels.
2. **Stack: Astro + React, using Graft.** Both the landing page and the docs are
   one Astro app with React islands where interactivity is warranted, reading its
   own content through Graft (`@usegraft/sdk-astro`). Dogfood, not a static brochure.
3. **Deploy target: Vercel** (for now). Build for Vercel's Astro adapter. The
   whole point is portability — migrating later is cheap, so don't over-abstract
   the host now.
4. **Design bar: no defaults, ever.** The landing must speak taste — animated
   SVGs, peculiar sections where peculiarity earns its keep, zero generic
   AI-slop layout. Bento grids whose cells embed **live product UI** (the studio
   cell contains actual studio elements), not screenshots. Design skills in
   force: `emil-design-eng`, `make-interfaces-feel-better`, `apple-design`,
   `animation-vocabulary` (+ Emil's review skills for polish passes).
   **(2026-07-12) Direction v2 locked after competitor study** — see "Design
   direction v2" below. Palette: **black / ivory / vermilion** (the botanical
   green is dead; operator: "black and something"). Docs UI: **Fumadocs**
   (officially supports Astro + React) powered by Graft as the source.
5. **Build order: docs shell → studio → landing.** Docs force the design system
   against real content. `@usegraft/studio` is an **opt-in Studio** (Drizzle-style
   `graft studio` locally; hostable via `graft serve --studio`) whose UI is only
   a client of an **OpenAPI read surface** — every operation also on MCP + CLI
   (headless dashboard parity). React panels are exported for landing embeds;
   the full edit/decide Studio story stays later.

---

## Design direction v2 (2026-07-12) — the study and the answer

Operator supplied four landing screenshots (Prismic light, Prismic dark/dev,
Basehub, Fumadocs) with the brief: _study section by section, take
inspiration, be better, tell our story in the design._

### What each does well (steal the move, not the look)

**Prismic (light, marketing):**

- Four-card feature row where **every card contains a mini working product UI**
  — not icons, product.
- The MCP diagram section ("One prompt. All your pages, updated"): ChatGPT +
  Claude cards wired to a central MCP node. **They market the agent surface as
  a diagram.** We _are_ the agent surface — ours must be live, not a picture.
- Numbered vertical "launch in minutes" steps with a sticky product pane.
- Weakness to beat: everything is screenshots and stock photography; nothing
  moves; the product is never actually present on the page.

**Prismic (dark, developer):**

- "Build with your AI agent of choice" + a row of agent logos — names the
  agent-native audience directly.
- Clean perf/infra card grid. Weakness: generic SaaS dark; purple-on-black
  cards could be any product.

**Basehub:**

- Opens with **the actual app in an accent-stroked frame** — the product IS
  the hero art.
- Branch out → review → merge: three cards showing real UI fragments for the
  branching story (our CoW branching deserves better than theirs).
- The **alphabetical feature-index section** (@START, Agents, AI Commits …
  Webhooks as a selectable list with a live detail pane) — the most
  distinctive section on any of these pages.
- Hand-drawn "PLAY WITH IT" annotation — one human touch on a machined page.
- Weakness to beat: static screenshots everywhere; the index pane is the only
  interactive-feeling moment.

**Fumadocs:**

- Real **art direction**: dithered/halftone gradient spheres, mono type,
  restrained accent — a committed aesthetic, not a template.
- "TRY IT OUT" terminal card sitting on the art.
- Docs framework marketing itself _with its own docs UI_ embedded.
- The shadcn-style CLI card ("the shadcn/ui for docs") — exactly our
  `graft add` story.
- Weakness to beat: sections are beautiful but the story wanders; no single
  narrative spine.

### The synthesis — what beats all four

One narrative spine, told in design: **watch an agent operate a CMS, live.**
Every section is the product doing the thing, not a picture of it.

Landing blueprint (top to bottom):

1. **Hero** — left-aligned. Mono kicker (`the agent-native CMS`), Instrument
   Serif display: "The CMS where the agent is the operator." Sub: "and the
   human is optional." To the right / below: **the live loop** — an animated
   panel where an MCP `write_content` call types itself out, a compile row
   appears (`+1 added @ <sha>`), and the rendered page updates. This is
   Basehub's "product as hero" + Prismic's MCP diagram, but _running_.
2. **The loop diagram** — animated SVG: `MDX in git → compile → content_index
→ typed reads`, drawn as a schematic with vermilion flow marks; each node
   annotated in mono. (Our version of Fumadocs' art direction: editorial
   schematic instead of dither.)
3. **Bento** — the P7.5.3 studio elements live in cells: ApprovalQueue
   (approve a destructive call), BranchDiff, CompilationTrail (real
   `compilations` rows), FTS search box hitting `/api/fn`. Cells are real
   React islands on real reads — the move none of the four can make.
4. **Branching triptych** — branch → preview → merge as three panels with an
   animated branch line grafting back into trunk (vermilion union mark).
   Beats Basehub's three static cards because the line _moves_.
5. **The primitives index** — our version of Basehub's alphabetical index:
   the actual registry (`scoped-access, comments, seo, callout, faq,
commerce`) as a selectable list; the detail pane runs `describe_item`
   against the real MCP endpoint. `graft add commerce` as the terminal card
   (Fumadocs' CLI card, but the registry is queryable).
6. **Trust strip** — cold-agent gate: "operated cold, by CI, every commit" +
   audit/approvals row; mono, quiet, factual.
7. **Terminal CTA** — `pnpm create graft` (or current init path) in a
   terminal card; one vermilion button; no marketing paragraph.

Peculiarity budget (one per section, deliberate): the hand-set proof-sheet
annotations — small vermilion editorial marks (⌐, ×, underlines) in the
margins, like a proof annotated in red pen. That is the brand gesture that
ties to grafting wax + editorial red without a single stock illustration.

### Palette v2 (locked)

| Token      | Dark (default)                     | Light                |
| ---------- | ---------------------------------- | -------------------- |
| bg         | `#0E0D0B` warm ink black           | `#F7F5F0` warm ivory |
| bg-raised  | `#161511`                          | `#FFFFFF`            |
| text       | `#EDEAE2`                          | `#16150F`            |
| accent     | `#E8442E` vermilion (grafting wax) | `#D63A25`            |
| accent-dim | `#B5301F`                          | `#B5301F`            |
| structure  | rgba hairlines + mono greys        | same                 |

Dark is the default presentation (landing); docs follow the OS. Type stays:
Instrument Serif (display) / Instrument Sans (text) / IBM Plex Mono (labels,
code). Shiki: restrained near-monochrome themes (min-light/min-dark) until a
custom ink+vermilion theme in the polish pass.

### Docs = Fumadocs powered by Graft ✅ `085df9d` (P7.5.2b)

Fumadocs officially supports **Astro (with React)**. `/docs/*` is on
fumadocs-ui (DocsLayout, sidebar, search, TOC) with **Graft as the content
source** — the page tree built from `listContent("docs")`, bodies through the
existing MDX pipeline, search via Postgres FTS. Fumadocs is the UI; Graft stays
the CMS. Hand-rolled `Docs.astro` / `Base.astro` retired.

---

## What this unit is (and is not)

**Is:** a self-hostable Astro+React site (landing + docs) plus runnable example
apps that prove the SDK matrix (Next / Astro / SvelteKit) against a real Graft
runtime.

**Is not:** a mandatory admin UI. Studio is **opt-in** (OpenAPI-first; MCP/CLI
parity) — we win by _not_ locking operators into a dashboard. No competitor
benchmarking. Nothing here becomes a required runtime dependency — the site is
a leaf app, not a package others import.

**Three deliverables, one unit:**

1. **Landing + docs site** — Astro + React, reads itself via Graft.
2. **"Why Graft" page** — the product story: benefits + what makes it different,
   no competitors.
3. **Example gallery** — Next (exists) + **Astro** + **SvelteKit** example apps
   (the P7.4 follow-ups, phases.md:356–357), showcased from one place.

---

## Stack & location (locked)

**Astro app + React islands** at `examples/docs-site/` (workspace already globs
`examples/*`). The site reads its own content through `@usegraft/sdk-astro` +
`graftRoute`, so building it **closes the P7.4 "Astro example app" gap** in the
same breath — one app earns two checkboxes. React is used for the interactive
bits (nav, code-tabs, any live demo island); Astro carries the static shell.

**SvelteKit** gets a _separate_ minimal app (`examples/gallery-sveltekit/`) so
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

Docs _content_ is authored MDX compiled by `@usegraft/compiler` and read back
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
  recompile" invariant as a _feature_: no lock-in, no opaque content tree.
- **Copy-on-write preview branches.** `graft branch`/`merge`, overlay + neon
  backends — real previews without cloning prod data. Link `branching.md`.
- **You own your primitives.** `graft add` copies components into your repo
  (shadcn-style) — no plugin security surface, no hosted black box. Link
  `registry.md`.

Plus the portability story the operator called out: **"deploy anywhere, migrate
cheaply"** — embedded or `graft serve`, Vercel today, container tomorrow, same
bytes (`packaging.md`). That _is_ a differentiator stated as a benefit.

Rules: every capability claim links to the primitive/doc that backs it (receipts,
so the page can't drift from reality). No feature-matrix, no logos, no "vs."

---

## Example gallery

Index page cards each runnable example: framework, SDK package, features it
exercises, "run it" instructions, screenshot/live link.

| Example             | SDK                    | Proves                                                             |
| ------------------- | ---------------------- | ------------------------------------------------------------------ |
| `landing-page`      | `@usegraft/sdk-next`      | RSC reads, MdxBody, revalidate webhook, functions, MCP route       |
| `docs-site`         | `@usegraft/sdk-astro`     | typed reads (no memo) + `graftRoute` endpoint mount, React islands |
| `gallery-sveltekit` | `@usegraft/sdk-sveltekit` | typed reads + `graftRoute` `+server.ts` mount                      |

Each example must **actually boot** against a Graft runtime — no faked
screenshots. The gallery is the visual proof that identical-bytes packaging holds
across three frameworks.

---

## Docs site — page inventory (proposed)

Grounded in what already exists, so writing = surfacing, not inventing:

- **Getting started** — `graft init` → `compile` → `dev` (`@usegraft/cli`).
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

1. ~~**Scaffold + design foundation**~~ ✅ P7.5.1
2. ~~**Docs shell + pages**~~ ✅ P7.5.2 (`b8d87f3`)
3. ~~**Fumadocs migration**~~ ✅ P7.5.2b (`085df9d`) — shell retired; Graft stays source
4. ~~**Opt-in Studio (OpenAPI-first)**~~ ✅ P7.5.3 — `graft studio` +
   `graft serve --studio`; OpenAPI at `/api/studio/v1/openapi.json`; MCP/CLI
   parity; read-only panels (ContentTree, Compilations, Branches, Approvals list)
5. **Landing + "Why Graft"** — the bento embeds live studio panels (from
   `@usegraft/studio/panels`); animated SVGs; benefits-only story with receipts.
   **← next**
6. **`examples/gallery-sveltekit`** minimal app (closes SvelteKit example gap).
7. **Gallery index** linking all three; boot-check each example.
8. Polish pass with Emil's review skills; update `packaging.md` status +
   `phases.md` (tick P7.5, **close Phase 7**).

---

## Field notes — competitor landings (design research, 2026-07-11)

Browsed live for inspiration only — **nothing competitor-facing ships** (decision 1).

### Sanity (sanity.io — live read)

- **Type does the talking:** custom grotesque (Waldenburg) at ~96px, weight 400,
  very tight tracking (−4%). Big-type-light-weight reads expensive; no gradient-
  text slop anywhere.
- **Palette:** white / near-black `#0b0b0b`, cool gray borders, then _soft_
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
  to the same agent story. Our landing must out-credibility them: they _narrate_
  agent ops; we can _demonstrate_ them (MCP + cold-agent gate are real).

### Basehub (basehub.com — live read)

- **Market signal: "BaseHub Is Joining Vercel"** (banner, verbatim). The
  agent-native CMS space is consolidating; independence + self-host is now a
  _differentiator we hold_.
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
