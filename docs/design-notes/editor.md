# Studio editor v2 — the authoring canvas (L2)

> Decided 2026-08-10. Pairs with the launch plan (phases.md).
> Status: **canvas + typography shipped** (`46cf092`); **generic component cards
> shipped**. Next: the Zod-driven frontmatter form.

## The complaint, stated precisely

The operator's words: _"our editor is too ugly… it could be better"_, with Mintlify's
web editor as the reference — _"how it displays stuff in a kind of word document
format, but then option for raw MDX"_.

Looking at the running Studio against `examples/docs-site`, three things are wrong,
and only one of them is taste:

1. **MDX components render as raw JSX text.** `what-is-graft.mdx` passes the fidelity
   gate and edits in Rich mode — headings, lists, and tables are real — but its two
   `<DocCards>` blocks sit in the canvas as angle-bracket soup. remark parses an
   unbroken JSX block as an `html` node, and an html node's view is its source. So
   the best documents in the project get the worst-looking editing experience.
2. **The canvas does not use its own type scale.** `tokens.css` defines
   `--text-xl: 2.25rem` and labels it _doc h1_; the editor renders h1 at
   `--text-lg` (24px). Body is 16px where published docs are 18px. The result is a
   flat grey column where nothing is bigger than anything else — and, worse, what
   you edit does not look like what you publish.
3. **Frontmatter reads as a debug panel.** Small-caps mono labels over bare inputs,
   flush against the body, with no sense of being _settings_ rather than content.

## Library decision: keep Milkdown; no new parser

**Liveblocks is rejected.** It is a commercial hosted service (paid past a free
tier), which fails the open-source constraint outright. It also solves a problem we
do not have: multiplayer presence. Graft's model is git-authoritative single-writer;
real-time co-editing of a file whose truth lives in git would need conflict
resolution we deliberately delegate to git.

**Milkdown/Crepe stays** (MIT, ProseMirror + remark). The load-bearing property is
that it is _markdown-native_: remark parses in and remark serialises out, so
round-tripping is the library's core rather than a bolted-on export. Every save
rewrites the author's file, so that property is not negotiable — and it is exactly
what Slate/Plate, TipTap, and BlockNote would each require us to rebuild, because
their document models are not mdast.

**`remark-mdx` was planned and then not needed** — recorded here because the reason
is the better design, not a shortcut. Reading the live document model showed
Milkdown stores an unbroken JSX block as an inline **atom** node whose `value`
attribute holds the block's exact source bytes. A ProseMirror **node view** can
therefore change what that block _looks_ like while the node itself is untouched,
so the serialiser still writes the author's original bytes: **fidelity is preserved
by construction rather than by a probe.** Adding remark-mdx would have replaced that
guarantee with a second parse/serialise round trip over every component in the
project — strictly more risk, for a tree we do not need in order to draw a card.

The trade is explicit: display-only cards cannot offer structural editing of
children (that is v2, and it is what would justify the real mdast tree). What they
buy is that no rendering path can corrupt a file.

## The innovation: components as cards, backed by the schema

Mintlify renders its own fixed set of components as blocks. Graft can go further,
because a Graft project already _declares_ its components: `graft add` copies
primitives into the repo and generates `components/mdx-components.ts`, and the
registry knows each item's shape.

So the canvas renders an MDX element as a **card**: the component name as a chip,
its attributes listed as name/value pairs, and its children as titled sub-cards. No
component is special-cased. An unknown component still gets a card — named, with its
props listed — rather than falling back to source.

Staged deliberately:

- **v1 (this unit, shipped):** generic cards for every component the block parser
  fully understands, driven by the block's own source. Display-only, with **Edit
  source** swapping in a textarea over that one block — a far smaller surface than
  sending the operator to the whole-document Raw MDX tab to change one prop. Inline
  markdown inside card text renders (`**bold**`, `` `code` ``, links) so a card never
  looks half-finished.
- **v2 (follow-up):** the registry teaches the card its prop types, so `href` gets a
  document picker and an enum gets a select — the same "one Zod layer" idea reaching
  the editor. Structural editing of children belongs here too, and is the point at
  which a real mdast tree earns its cost.

## The renderer contract: declarations, owned like the component

A component author should be able to say how their block looks in the canvas.
Two constraints decide the shape of that.

**The Studio is a prebuilt bundle.** There is no bundler in the loop at runtime,
so it cannot import `components/Callout.tsx` from the project and render it. The
only way to let a third party control presentation with _code_ would be to
evaluate code they authored inside the editor, which is not something to ship.
So the contract is **declarative data the editor interprets** —
`EditorComponentSpec` in `@usegraft/contracts`: which prop is the title, which is
a link, which prop maps to which tone, which props are already implied.

**It is owned, not resolved.** A registry item ships `editor/<Component>.json`
with file role `editor`, and `graft add` copies it to `graft/editor/` beside the
component — so from that moment it is the operator's file. Rename a prop, retone
it, delete it. The Studio reads `graft/editor/*.json` **from the project, never
from `@usegraft/registry`**: reading the registry's copy would silently ignore
those edits and reintroduce exactly the plugin-black-box coupling the
shadcn-style owned model exists to avoid. It also means a third-party registry
needs no runtime reachability — the file is already in the repo.

Tones are a **closed set** (`info`/`warn`/`danger`/`success`/`neutral`) mapped to
theme roles. A declaration chooses a _meaning_, never a colour, so no
third-party component can introduce a hue the theme does not own or land
unreadable in one scheme.

Everything is optional and failure is local: a component with no declaration
gets the generic card, and a malformed declaration is skipped rather than fatal —
one bad file costs one styled card, not the editor.

**Refusing is a feature.** The parser returns null — and the block keeps its old raw
rendering — for anything it does not fully understand: spread props, expressions in
children, several roots in one block, lowercase HTML tags, malformed markup. A card
that quietly omitted a prop or dropped a child would be worse than the soup it
replaced, and the fallback costs nothing because it is the pre-existing behaviour.

## Fidelity is the constraint, not a feature

The existing fidelity probe stays exactly as it is — it did not need to get
stricter, because cards never enter its path. The probe governs what remark
serialises; a node view changes only what the browser paints. A document that Rich
mode would rewrite (`the-model.mdx`, whose table row Milkdown reflows) still opens
in Raw MDX, cards and all. The discipline proven in `composeDocument`
applies here too: **a document that is opened and not edited must serialise back
byte-identically.** That is a test over the repo's real documents, not a unit
fixture — the composeDocument fix shipped only after all 27 authored docs
round-tripped, and a bug in the fix itself was caught precisely because the check
ran against real files rather than fixtures.

If a document cannot round-trip, it stays in Raw MDX with the reason shown. Losing
a nicer editor is cheap; losing the operator's components is not.

## Canvas: a sheet, not a column

The "word document" quality the operator is asking for is mostly one idea: the
content sits on a **sheet** — a surface distinct from the chrome around it, with
generous margins and editorial type — and the chrome stays quiet.

- Content surface `--paper`, chrome `--paper-sunken`, so the sheet reads as a page.
- Measure ~68ch. Body at `--text-md` (18px) and h1 at `--text-xl` (36px): the
  scale the tokens already declare, and what the published docs actually use.
- Headings in `--font-display`, matching the rendered site.
- `text-wrap: balance` on headings, `pretty` on body.
- Chrome (labels, state, tabs) stays mono and small. Contrast between chrome and
  content is what makes content feel like content.

## Out of scope for this unit

- The registry-typed prop widgets (v2 above).
- Slash-command insertion of blocks — reuses the existing ⌘K palette; lands after
  cards exist to insert.
- The "Changes" diff drawer (git status → reviewable diff before commit).
