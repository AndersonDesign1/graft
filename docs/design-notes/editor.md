# Studio editor v2 — the authoring canvas (L2)

> Decided 2026-08-10. Pairs with the launch plan (phases.md). Status: building.

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

## Library decision: keep Milkdown, add remark-mdx

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

**What we add is `remark-mdx`** (MIT, the unified/MDX ecosystem — the same parser
MDX itself uses). With it, `<DocCards>` stops being an opaque `html` node and becomes
a real `mdxJsxFlowElement` in the tree: tag name, attributes, and children, all
addressable. That is the difference between showing source and showing a component.

## The innovation: components as cards, backed by the schema

Mintlify renders its own fixed set of components as blocks. Graft can go further,
because a Graft project already _declares_ its components: `graft add` copies
primitives into the repo and generates `components/mdx-components.ts`, and the
registry knows each item's shape.

So the canvas renders an MDX element as a **card**: the component name as a chip,
its attributes as a small typed form, and its children as editable content. No
component is special-cased. An unknown component still gets a card — named, with its
props listed — rather than falling back to source.

Staged deliberately:

- **v1 (this unit):** generic cards for every MDX element, driven by the parsed
  tree. Attributes editable as text. Children edit in place.
- **v2 (follow-up):** the registry teaches the card its prop types, so `href` gets a
  document picker and an enum gets a select — the same "one Zod layer" idea reaching
  the editor.

## Fidelity is the constraint, not a feature

The existing fidelity probe stays and gets stricter, because the failure mode it
guards is silent file corruption. The discipline proven in `composeDocument`
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
