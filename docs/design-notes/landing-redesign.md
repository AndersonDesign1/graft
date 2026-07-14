# Landing redesign — reference analysis & concept (v4, monochrome)

> Companion to `examples/docs-site/src/styles/tokens.css` (design tokens v4).
> This note records the section-by-section analysis of three reference sites
> (basehub.com, prismic.io, fumadocs.dev — live-inspected 2026-07-12) and the
> concept synthesized from them, now built in `examples/docs-site`.

## 0 · The accent is gone. Elevation carries the design. (2026-07-14)

The palette went vermilion → cambium green → **no accent at all**. The dead ends
are worth recording, because each one taught the constraint that produced v4.

**Why vermilion died.** Live inspection of basehub.com gives
`--color-accent: rgb(255 108 2)` on `--color-bg: rgb(4 4 4)` — orange on black,
`theme-color: #000000`. Our vermilion sat ~15° away in OKLCH hue on the same
black ground: a sibling brand, not a distinct one. It also *failed contrast* —
`#e8442e` as small mono text on black is APCA **Lc -55**, under the 60 floor,
and ivory labels on the accent fill were **Lc -50**.

**Why a colored accent can't work on a black stage at all.** Solve for the
lightness each hue needs to reach APCA 75 as text on black: red, blue and
magenta collapse to pastels (chroma 0.067–0.091 — vermilion literally becomes
pale pink `#f8bdb3`). Only green stays vivid (chroma 0.189). But green *reads as
"success"*, not as identity — and the whole CMS field is already holding a hue
(BaseHub orange, Contentful blue, Strapi indigo, Storyblok teal). A colored
accent here is either illegible, borrowed, or a status light.

**v4 — the position nobody occupies.** Monochrome, in the Linear mould:

- **Elevation is lightness, not borders.** One neutral ramp (hue 95, chroma
  0.003 — a whisper of warmth, so it reads as ink-on-paper, not a cold UI gray).
  Surfaces step *up* from the black stage: `#000` → sunken `#100f0e` → raised
  `#1b1b19` → elevated `#272625`. On a black stage a drop shadow is invisible;
  the surface itself has to get brighter.
- **"Primary" is not a hue — it is BRIGHT.** The mark, the union, the active
  state and the filled button are simply the lightest thing on screen
  (`#f2f2ef`), with the fill and its label inverting per scheme. Hover cannot
  change hue, so it changes lightness: one step, same direction.
- **`--success` = `--primary`.** No traffic lights. The graft took; it's bright.
- **`--danger`** is the only hue in the system, and it is function, not identity:
  errors only, never brand. Error text targets the non-body floor (Lc 60) —
  an APCA-75 red on black would be pale pink.
- **The code is the only colored thing on the page.** Syntax highlighting keeps
  its amber/azure because that is *content*, not chrome. Verified: the only
  chromatic paints on the rendered landing are the error red and the two syntax
  tokens.

This also fixed a latent bug the accent work surfaced: the old muted foreground
(`#a39f93`) was **Lc -47** on black — body copy under the 75 floor. The neutral
ramp puts muted at **-79** and faint at **-65**.

## 1 · Reference analysis

### 1.1 BaseHub (basehub.com)

The closest product to Graft (git-shaped CMS) and the strongest overall reference.

- **Navbar** — thin, dark, quiet; product name + few links + one filled CTA. No mega-menu. The restraint signals "developer tool," not "marketing platform."
- **Hero** — one bold claim ("The AI-Native Headless CMS"), two lines of support, one CTA. The real hero is **the product itself**: a full embedded screenshot/live frame of the editor UI with an orange focus ring around it and a hand-written "PLAY WITH IT" annotation rotated ~15° — an editorial mark that breaks the grid and directs the eye. Engineering note: the frame is a real DOM embed, not a flat image, so text stays crisp at every DPR.
- **Feature narrative** — sections alternate copy + *live-looking* product UI (branch/review/merge cards mirror the git workflow 1:1). Each section is introduced by a small mono label ("Editor", "Branching", "Developer Experience") — a consistent wayfinding voice.
- **Vertical thread** — a thin connector line with nodes runs between sections (visible dots/plus marks at section boundaries), stitching the page into one continuous story. This is the single best structural idea on the page.
- **Feature index** — a two-column list ("@START, Agents, AI Commits, … Webhooks") where each row swaps a per-character duplicated label on hover (every glyph exists twice in the DOM; hover flips them with a tiny per-character stagger). Selecting a row swaps the right-hand live panel. Data-dense, interactive, memorable.
- **Code section** — real `import { basehub } from "basehub"` code with framework tabs (Next/Astro/SvelteKit). Line numbers, syntax highlighting, "Read docs" beneath. Typesafety is *shown*, not claimed.
- **Color** — near-black warm ground, one orange accent used sparingly (annotation, focus ring, link marks), white type. Testimonials inline, single-voice, believable.
- **Type** — a geometric sans for display, mono for labels/annotations. Scale restrained; hierarchy from weight and space, not size explosions.
- **Motion** — mostly scroll-triggered opacity/translate reveals + the hover-flip letters; nothing gratuitous. The page feels alive because the *content* is alive (product frames, code), not because things fly around.

### 1.2 Prismic (prismic.io)

Two-audience page (For Marketers / For Developers toggle literally splits the hero).

- **Navbar** — classic SaaS: many items + dropdowns, two CTAs. Heavier than we want, but the audience toggle chip pattern (pill pair in the hero) is a good idea for a dual-audience product.
- **Hero** — dark dev-variant: purple-tinted gradient field behind display type; light marketing variant: soft neutral. Same layout, two skins — the toggle proves the design system.
- **Live inspection** — Next.js app; **no** GSAP/Lenis; custom fonts ("headingsFont/copyFont"); 40 inline SVGs, zero canvas/video on the marketing page. All motion is CSS-driven: logo marquee (linear infinite), scroll reveals, card hovers. Lesson: a rich page does not need an animation runtime.
- **"One prompt. All your pages, updated"** — the MCP diagram: ChatGPT-card → Prismic MCP node → Claude-card, connected by animated dashed SVG connectors. Communicates an abstract capability (agents editing content) with one glance. The connector-diagram is the pattern to steal-then-transform.
- **Numbered workflow** — "How your team can launch pages" is a vertical 1-2-3-4 list where the active step highlights and the right panel swaps; a dotted line ties the steps. Scroll/step-driven storytelling with cheap engineering (position: sticky + IntersectionObserver).
- **Bento features** — 2×2 cards ("Visual content modeling", "One-click syncs", "Automatic TypeScript", "Previews at every step") with muted body text; quiet grid rhythm.
- **Social proof** — stat pairs (4,800+ marketers / 23× G2) + carousel of story cards with real faces.
- **Type/color** — big friendly humanist display; purple accent on dark, near-black on light; generous whitespace; rounded-2xl cards everywhere (this is precisely the "template SaaS" texture we must avoid).

### 1.3 Fumadocs (fumadocs.dev)

The taste reference — a docs framework whose landing is itself a designed object.

- **Live inspection** — Geist + JetBrains Mono on `#121212`; **3 canvases** (WebGL dither shaders: the huge halftone-dithered orange sphere, the duotone landscape panels); 39 SVGs.
- **Hero** — display type over a dithered-gradient sphere; a rotated hand-written annotation ("the React.js docs framework you love"); below, an embedded *real* docs UI frame (sidebar + Quick Start) — the product as hero, again.
- **Texture as identity** — halftone dither, duotone photography, terminal frames: a print/zine texture language executed with shaders. The site is memorable because it has *material*, not because it has motion. Lesson: pick one texture voice and commit (ours: editorial print — hairlines, off-white type, elevation instead of accent).
- **Terminal card** — "TRY IT OUT: pnpm create fumadocs-app" rendered as an actual terminal with prompt frames. CLI-first products should show the CLI.
- **Bento** — cards mix live component demos (search dialog embed, MDX editor pane with output), duotone art, and code. Live > screenshot everywhere.
- **Editorial humor/voice** — "Anybody can write.", "Docs for Engineers.", "Open Source Forever." Sections are short declarative sentences used as h2 display — the copy *is* the design.
- **Color** — near-black + cream + one hot orange; light sections interleaved (yellow-cream band) to pace the scroll.
- **Motion** — restrained: hover states, some reveals; the shaders carry the aliveness at near-zero motion cost. `prefers-color-scheme` respected.

### 1.4 What actually works (cross-cutting)

1. **The product is the hero image.** All three embed real UI/code/terminals instead of illustrations.
2. **One accent color, spent like money.** Orange (BaseHub, Fumadocs) / purple (Prismic) against near-black; accent = interaction/mark, never decoration fields.
3. ~~**A connective spine.**~~ **Cut 2026-07-14.** BaseHub's node-line was the single best structural idea on their page — which is exactly why we cannot have it. We shipped a scroll-progress spine, then removed it: a competitor's most recognizable structural signature is the last thing to borrow. The section numbers (§01…) stay; the line does not. Its replacement is *material*, not structure — see the grain overlay.
4. **Mono voice for wayfinding.** Small mono/uppercase labels introduce sections in all three.
5. **Texture beats animation.** Fumadocs' shaders and BaseHub's annotations do more for memorability than any scroll-jack would. Motion budget goes to *meaningful* state change (hover flips, step activation, type-out).
6. **Real code, real tabs, real output.** Nothing converts a developer like their own stack rendered truthfully.

## 2 · Concept — "The proof sheet"

**Thesis.** Graft's landing is set like a *typeset proof under revision*: a
black stage, off-white type, hairline rules, and no accent at all — emphasis is
carried by brightness and elevation. The page is a living document about a
system where documents are code.
Every section is *live*: the terminal types real CLI output, the pipeline draws
itself, the MCP transcript replays a real agent session, the contact form writes
a real Postgres row and shows its correlation id. Nothing is a screenshot.

Explicitly avoided: rounded-2xl card grids, gradient blobs, glassmorphism,
generic bento, purple-on-dark SaaS, testimonial carousels.

- **Structure — the scion line.** One continuous bright thread runs the length
  of the page in the left margin rail (BaseHub's node-line, re-imagined as the
  grafted scion). It fills with scroll; each section is a numbered node
  (`§01 …`) annotated in mono — the page as one long graft from seed (hero) to
  fruit (CTA).
- **Hero.** Instrument Serif display: “Content is code. **Agents are the
  operators.**” with a proof-mark drawn under the key phrase (animated
  stroke). Right/below: a live terminal that types `pnpm graft init` →
  `graft compile` → a real ChangeSet (`+2 added ~1 changed`), caret blinking.
  An SVG rootstock/scion drawing grows behind the display type; the union
  point pulses bright — the cambium lining up.
- **§ The loop.** The PRD pipeline (MDX → compile → Postgres → typed read →
  render) as a horizontal draw-on-scroll diagram; each stage card activates as
  the connector reaches it. Sticky step-scroll on desktop, stacked on mobile.
- **§ Agent-native.** A replayed MCP session: `write_content` fails with
  `SCHEMA_VALIDATION_FAILED` + its `fix`, agent corrects, compile succeeds —
  the self-teaching error story told honestly (our real error JSON).
- **§ Branching.** Interactive: Branch / Edit / Merge buttons drive an overlay
  visualization (rows copied-on-write, tombstones, leaf-wins) — the P4 model
  as a toy you can poke.
- **§ Typed reads.** Paired panes: hover a frontmatter field, the inferred TS
  type highlights — `DocumentData<typeof pages>` shown, not claimed.
- **§ Registry.** `graft add commerce` → files stagger-drop into a tree;
  "owned code, no plugin black box."
- **§ Runtime.** The two topologies (embedded / `graft serve` container) as a
  small animated schematic; audit/approvals as ledger lines.
- **§ FAQ + CTA.** FAQ from the *live* `home` document's `faqs` field. The
  contact form posts to `POST /api/fn/submitContact` and, on success, prints
  the row id — with the mono annotation "row written to data_records ·
  audit logged". The form is the demo.
- **Footer.** A colophon: type, stack, and "This page is served from
  content_index; its copy is MDX in git."

**Motion system** (tokens v2): custom curves only (`--ease-out`,
`--ease-in-out`), 140–240ms UI, longer only for explanatory draws;
scroll-driven = IntersectionObserver + CSS transitions
(transform/opacity only); type-outs via rAF; everything gated by
`prefers-reduced-motion` (fade-only fallbacks). No animation runtime deps.

**Docs.** Rebuilt on Fumadocs (`examples/docs`), content owned by Graft (docs
collection; agents write via MCP), themed with the same tokens: ivory/ink,
Instrument Serif headings, bright marks, hairline rules over Fumadocs UI CSS
variables.
