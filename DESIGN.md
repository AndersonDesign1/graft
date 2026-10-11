# Graft design language

This file is how Graft looks, and why. Read it before you design, build or
review anything a person sees: the docs site, Studio, an example app, a social
card. It is written for people and agents alike. If you follow it you should
not need anyone's taste but this file's.

The judgment lives here. The mechanics live in two places:

- **Tokens and components:** `@usegraft/tokens` (`tokens.css`) holds every
  value, and the docs site's MDX components
  (`examples/docs-site/src/components/mdx`) hold the structure. Use them; do
  not read them into context to reverse-engineer them. The components are
  listed in this file.
- **Copy:** the `graft-writing` skill. Design and words are one pass; a page
  is not done until its copy follows that skill too.

Every rule below is something you can check by looking. If a rule here is
vague, that is a bug in this file: fix the rule, do not guess.

## Scope right now

- **Docs** (`examples/docs-site`, `/docs/*`) follow this file in full.
- **The landing page** (`/`, `/why`, `/security`) keeps its current design.
  Do not restyle it as a side effect of other work. It gets its own pass.
- **Studio** (`packages/studio`) follows this file in full, plus the
  [Studio](#studio) section for what an app needs that a page does not.

## Who opens a Graft page, and what they need

| Reader                          | Arrives from                             | Needs within one screen                        |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| A developer evaluating Graft    | GitHub, search, a link                   | What Graft is, the one command, proof it works |
| A developer building with Graft | The docs sidebar, search                 | The exact code and the exact next step         |
| An agent operating a project    | `llms.txt`, Markdown twins, the docs MCP | Plain text with the same facts as the page     |
| An editor in Studio             | A teammate's invite                      | What changed, what is waiting for them         |

Design for the first two, never at the expense of the third: every docs page
has a Markdown twin, and nothing important may exist only as a visual.

## Priority order

When rules compete, protect them in this order:

1. Facts. Version floors, commands, error codes and APIs are copied from the
   source, never paraphrased into something untrue.
2. The reader's next action is unmistakable.
3. The invariants are visible where they matter: Git is the source, one
   schema checks everything, destructive work waits for a person.
4. Graft is recognizable: the wordmark, the warm stage, the type, the pills,
   the colored marks.
5. The page has a composition specific to its material.
6. Polish: motion, hover states, optical alignment.

## The thesis

**Monochrome chrome, colorful content.** Surfaces, text and controls use one
warm neutral ramp (hue 95): chalk paper and near-black ink in light, a
black stage and off-white type in dark. There is no brand accent color. The
primary button, the active nav item and the selected tab are simply the
brightest (dark) or darkest (light) thing on screen.

The color on a Graft page comes from what the page is about:

- **Syntax** in code blocks, and the terminal's hues in inline CLI chips
  (`graft compile`): the binary, the command, flags and arguments each have
  their color.
- **Framework and tool marks** in their own colors: Next.js, TypeScript,
  Astro, React, Svelte and the rest, in tabs, tables and next-step links.
  Package-manager marks (npm, pnpm, bun) take the text color so they read in
  both themes.
- **Callouts:** the tone's hue (note blue, warning amber, danger red) on the
  icon and the label. Never on the fill, never as a side rail.
- **Danger** for errors and destructive actions, always with an icon or a
  word.

Success is not green. A compile that worked is bright, not a traffic light.

What only Graft has is the material: MCP transcripts, `fix` lines, compile
output, approval gates. Show it.

## Identity

- **Wordmark:** `graft.` lowercase, with the period, IBM Plex Sans 600,
  tracking -0.035em, 19px (`--type-wordmark`, `--tracking-wordmark`). A
  surface name follows after a faint slash: `graft. / Docs`. The stage
  (`beta`) follows as plain faint text: `graft. / Studio` in Studio. The
  landing page still draws its own and moves to this one when it is rebuilt.
- **Docs header:** wordmark and surface name left, at most three section
  links, GitHub icon right. 56px tall, translucent background, hairline
  bottom border.
- **End of page:** last updated and the edit and report links
  (`PageMeta`), then the "Powered by Graft" badge. Nothing else.

## Type

IBM Plex Sans for everything a person reads: prose, headings, labels,
buttons, tables, numbers. IBM Plex Mono only for code, commands, file paths,
error codes, tool names and other literal identifiers, and only for the
identifier itself, not its sentence or its table.

**Never use mono for labels, eyebrows, navigation or section names.**

Use roles, never raw sizes. Weights are 400, 500 and 600 only.

| Role       | Token               | Size / leading / tracking | Use                                     |
| ---------- | ------------------- | ------------------------- | --------------------------------------- |
| Title      | `--type-title`      | 32-40px / 1.15 / -0.032em | A page's h1                             |
| Section    | (in `fumadocs.css`) | 26px / 1.2 / -0.02em      | h2                                      |
| Subsection | `--text-h3`         | 20px / 1.3 / -0.01em      | h3 and step titles                      |
| Lede       | `--type-lede`       | 18px / 1.6                | The one sentence under a title          |
| Body       | `--doc-body`        | 17px / 1.75               | Reading; callout bodies at 16px         |
| Compact    | `--text-sm`         | 14px / 1.5                | Sidebar, buttons, pills, tables, labels |
| Meta       | `--type-meta`       | 13px / 1.45               | Captions, group labels, dates           |
| Code       | `--text-sm`         | 14px / 1.7                | Code blocks                             |

`--type-section` (24px) and `--type-subsection` (19px) are the sizes h2 and
h3 move to next; until then the table above is what ships. `--text-2xl` and
`--text-3xl` are the landing page's display sizes and are not used in docs.

Rules you can check:

- Prose, code and tables share one column (`--doc-column`, 800px) and one
  left edge. `--measure` (68 characters) is for a standalone line such as a
  kicker.
- Headings use `text-wrap: balance`, paragraphs `text-wrap: pretty`.
- Headings are sentence case and state the claim or the task ("Add your own
  content", not "Content" and not "CONTENT").
- No all-caps labels or emphasis. Acronyms and names (APCA, MCP, MDX) and
  code keep their own case.
- Numbers that line up use `font-variant-numeric: tabular-nums`.
- No text below 13px, except a mono identifier inside a frame (a code
  block's path, a field's type) at 12px. Rewrite before shrinking.
- No em dashes in copy. The writing skill has the details.

## Color tokens

Components read the semantic tokens below or their aliases (`--paper`,
`--ink`, `--hairline`, `--mark`), never the palette. Literal colors appear in
`tokens.css` and in brand marks, nowhere else. A hover wash is
`color-mix(in oklch, var(--ink) 5%, transparent)`, so it follows the scheme.

| Token                                                     | Means                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `--background`                                            | The page                                               |
| `--muted`                                                 | Sunken: code blocks, callouts, table heads, pill hover |
| `--card`                                                  | Raised: the agent prompt, menus                        |
| `--elevated`                                              | Floating: menus, popovers                              |
| `--foreground`                                            | Text                                                   |
| `--muted-foreground`                                      | Secondary text, safe for body copy                     |
| `--faint-foreground`                                      | Metadata only, 13px and up                             |
| `--border`, `--border-strong`                             | Hairlines; strong for controls and hover               |
| `--primary`, `--primary-hover`, `--primary-foreground`    | The bright fill and its label                          |
| `--danger`                                                | Errors and destructive actions                         |
| `--callout-note`, `--callout-warning`, `--callout-danger` | Callout icons and labels                               |
| `--code-*`                                                | Syntax and CLI chips                                   |
| `--scrim`                                                 | Behind a dialog or sheet: dims the page, never blurs   |

Every pairing is checked with APCA against its real background: body text
at |Lc| 75 or more, metadata at |Lc| 60 or more (Lc is negative for light
text on dark). Light and dark are both first-class and
follow the operating system.

## Space, shape, elevation

- **Space** is a 4px grid: `--space-1` (4px) to `--space-24` (96px). Inside a
  group 8-16px. Between groups 24-32px. Section turns in docs 64px.
- **Every gap has one owner.** A flow, stack or grid sets it; children reset
  their own margins. Never fix a bad gap with a one-off margin.
- **Radius** is concentric (outer = inner + padding): 3px
  (`--radius-inner`) for buttons, inputs and code spans, 6px (`--radius`) for
  cards, 10px (`--radius-outer`) for code blocks, tables, menus and the agent
  prompt. Pills are fully round; so are step numbers.
- **Elevation is lightness.** In dark, a raised surface is lighter, not
  shadowed. Shadows exist only on floating things (menus, popovers).
- **The page is one canvas.** A surface or border must mean something: code,
  a table, an interactive object, a callout. Never wrap a section, a
  paragraph or a metric in a card. Never nest a card in a card.

## Docs layout

A sticky header; a 268px sidebar from 768px wide, behind a menu button
below that; an article column up to 800px (`--doc-column`); a 268px contents
rail from 1280px wide, with last updated and the edit links under it.

The page head, in order: the title, the lede, the page-action pills, then a
meta line (section and reading time) in `--faint-foreground`.

Rules you can check:

- Nothing scrolls the page sideways at 390px. Wide code and tables scroll
  inside their own frame.
- Grid and flex children that hold text, code or tables have `min-width: 0`.
- Peers share edges, baselines, type roles and inner padding.

## Components

Compose pages from these. If none fits, write CSS in
`examples/docs-site/src/styles/fumadocs.css` that reads tokens, scoped to a
class of its own; never restyle an existing component from a page.

**Shell** (`docs-shell.tsx`): the top bar with the `graft.` wordmark, `/`,
the surface name and the stage label; the sidebar; the page head with its
action pills and meta line; the contents rail (`toc-rail.tsx`); search.

**MDX components** (`src/components/mdx`), the only ones an author writes:

| Component                     | For                                          |
| ----------------------------- | -------------------------------------------- |
| `<AgentPrompt>`               | The prompt that makes an agent do the page   |
| `<CodeBlock title>`           | A titled code frame around one fence         |
| `<Tabs labels>` with `<Tab>`  | Alternatives the reader picks once           |
| `<Steps>` with `<Step>`       | An order the reader must follow              |
| `<Callout label>`             | A point the reader must not miss             |
| `<DocCards>` with `<DocCard>` | Next steps at the end of a page              |
| `<FieldTable>`                | A schema's fields, read from the live schema |
| `<TierBadge>`                 | Which engine a page needs                    |

Markdown tables, fences and inline code render through `Table`, `Pre` and
`InlineCode`, so an author never writes a class name.

### When to use which

- **Page actions.** A row of pills under the lede: Copy page, View as
  Markdown, Open in ChatGPT, Open in Claude. Icon and label, 40px tall, 44px
  on touch. The copy pill swaps its icon to a check on success. On narrow
  screens the row wraps; it never collapses into a menu.
- **Agent prompt.** Every guide that ends in a working result opens with one,
  right after the page head: the exact prompt that makes an agent do the
  page, in a card titled "Let your agent do it" with a copy button.
- **Tabs.** For alternatives the reader picks once (framework, package
  manager). Each framework tab leads with its mark. Switching is instant.
- **Code block.** Always titled with its file path and a file icon, or
  "Terminal" with a terminal icon for a shell. A path is mono; "Terminal" is
  sans. Package-manager tabs (`<Tabs labels="npm, pnpm, yarn, bun">`) render
  as one code block led by a terminal icon, each tab with its mark, not as a
  second frame.
- **CLI chips.** An inline command in prose (`graft compile`,
  `pnpm add @usegraft/cli`) takes the terminal's hues: `InlineCode` colors a
  span that starts with `graft` or `pnpm`, or with a flag. Other inline code
  (a field, a value) stays monochrome.
- **Steps.** Only for an order the reader must follow. Each title is an
  action ("Compile your content"). Never number things that are not a
  sequence.
- **Callout.** At most two per page. The label is a sentence that states the
  point ("Deletes cannot be undone"), not a category ("Note"), and carries
  the tone's hue with the icon.
- **Table.** For lookup and comparison. Full column width, a quiet header,
  hairline rows, numbers right-aligned. Error tables are code, meaning, fix.
  A table of frameworks leads each row with the framework's mark.
- **Next steps.** `<DocCards>`: a title and one line per link.

## Studio

Studio is an app: it is scanned and operated, not read top to bottom. Every
rule above holds; this section adds what an app needs.

**Frame.** The docs' frame. A 56px top bar across the full width: the
wordmark and the branch left, search centred (24rem, with its shortcut), the
Commit or Publish button and the account menu right. A 268px sidebar under it
on the page colour holds navigation only. Below 48rem the sidebar opens as a
drawer from a menu button and search becomes an icon.

**Density.** 14px is the body size, 13px the floor. Controls are 36px; a
smaller control (32px in a toolbar, an icon button) pads its hit area to 40px.
Table rows are 44px, menu items 32px. Views open with a title (24px, 600), a
one-line description, then their content; sections inside a view use 16px 600
titles.

**State is a mark and a word.** Never a colored pill. The resting state shows
nothing, so the exceptions are what the eye finds.

| State                | Mark                  | Color               |
| -------------------- | --------------------- | ------------------- |
| Draft                | Filled dot            | Ink                 |
| New draft            | Ring                  | Ink                 |
| Deleted              | Dot, or trash icon    | `--danger`          |
| Needs a decision     | Dot                   | `--callout-warning` |
| Waiting for approval | Count, or shield icon | `--callout-warning` |
| Out of date          | Refresh icon          | Ink                 |
| File missing         | Dot                   | `--danger`          |

Amber means a person is needed and red means broken or destructive; nothing
else in Studio's chrome takes a hue. Diffs keep the code colors.

**One word per state, and the workspace's verb.** An edit not yet committed or
published is a Draft everywhere. The action is Commit on a laptop, Publish when
hosted, Submit for review without publish rights. A sentence about what to do
next uses `actionWord` (commit, publish, submit) and a sentence about what is
done uses `doneWord` (committed, published), both in `lib/studio.tsx`, so a
laptop never says "publish".

**The editing canvas** is the page it becomes: the docs' column, title size,
17/1.75 body and h2/h3 sizes, on the page colour with no card around it.

**Popups.** One material: the elevated surface, a 10px radius, the floating
shadow, `--scrim` behind modal ones. Open in 160ms, close in 100ms, from where
they were asked for.

| Kind    | For                                                   | Rules                                                               |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Menu    | Actions or a choice on one thing                      | Items are icon and label; group labels sentence case                |
| Dialog  | A short task that blocks                              | A visible close button, always; 480px wide by default               |
| Confirm | Before a delete or a discard                          | Focus starts on Cancel; the button names the action ("Delete post") |
| Sheet   | Reviewing a set before acting (commit)                | Slides from the right edge; a close button                          |
| Palette | Go anywhere, run anything                             | Opens instantly; shows its keys                                     |
| Tooltip | Naming an icon-only button                            | Never the only place a word lives                                   |
| Toast   | Undo after a delete, or work that finished off-screen | One at a time; errors stay next to their cause instead              |

Never `window.confirm`, never a blurred backdrop, never an animation on
success: a commit that worked ends in a still check.

## Motion

Default to stillness. The page is complete without any motion, and motion
never gates reading.

| Allowed                                                       | Duration, easing                         |
| ------------------------------------------------------------- | ---------------------------------------- |
| Press: `scale(0.96)` on pills, `scale(0.98)` on previous/next | `--duration-press` (140ms), `--ease-out` |
| Hover color, border and background                            | `--duration-fast` (180ms), `--ease-out`  |
| A DocCard lifts 1px on hover                                  | 160ms                                    |
| Anything new that opens (a menu, a popover), from its trigger | Under 200ms in, faster out, `--ease-out` |

The copy buttons swap their icon to a check with no animation, and say
"Copied" through a live region.

Never in docs: scroll-triggered reveals, typing animations, blinking
cursors, marquees, parallax, bounce, page-load sequences, animated keyboard
actions (search opens instantly), `transition: all`, `ease-in` on UI,
anything over 300ms in UI. Respect `prefers-reduced-motion` everywhere.

## Icons

Two kinds, never mixed up:

- **Interface icons** are Lucide, one set, `currentColor`, states through
  color and opacity. 16px, or 14px in the pills and the meta line. Stroke
  1.75 in the chrome, 2 in callouts and steps.
- **Marks** are the real logos of frameworks and tools (Next.js, TypeScript,
  Astro, React, Svelte, TanStack, Node.js, Docker, Postgres, SQLite, npm,
  pnpm, bun, ChatGPT, Claude). They sit beside the name they stand for, at the
  text's height. They keep their own colors, except where a brand color would
  vanish on one theme (package managers use `currentColor`).

An icon always sits beside a word or has an `aria-label`. Never put an icon
in a colored tile, never use one as section decoration, never use emoji.

## Accessibility

One `h1`, ordered headings, a skip link, landmarks, visible focus (2px ring in
`--focus-ring`), native controls, real `<table>` with `scope`, a label on every
icon button, 40px hit areas on desktop and 44px on touch. A table that can
scroll is focusable. Meet WCAG AA and APCA as above, and never encode meaning
in color alone: a callout's hue always comes with its icon and label.

## Reject list

Do not ship any of these in docs:

- Mono uppercase eyebrows or kickers above headings.
- Gradients, glows, glass, grain, hand-drawn decoration.
- Content that fades in on scroll; typing or replay animations that run on
  load.
- A box or pill around metadata (`BETA`, `New`, reading time). Pills are for
  actions.
- Colored side rails or colored fills on callouts or cards.
- Syntax colors on inline code that is not a command.
- Cards for every section, cards in cards, borders that fix weak hierarchy.
- Text under 13px outside a code frame, weights other than 400/500/600,
  ad-hoc font sizes.
- Brand marks redrawn, recolored or used as decoration away from their name.
- Em dashes, "truly", "seamless", "powerful", "blazing".

Restraint is not emptiness. Every page still has one strong focal object.

## Known gaps

What ships today and breaks a rule above. Fix these when you touch the
component; do not copy them.

- Fence and prompt copy buttons are 32px, under the 40px hit area.
- The Copy page pill changes its own label to "Copied" or "Copy failed",
  which changes its accessible name. It should keep "Copy page" and announce
  the result in a live region, as the fence and prompt buttons do.
- `InlineCode` also colors file paths (`graft.config.ts`, `src/`), and leaves
  `npx` and `npm` commands plain.
- Markdown tables have no `scope` on header cells, do not right-align
  numbers, and cannot show a framework's mark. Only `FieldTable` sets
  `scope`.
- Bold text in prose renders at 700, the browser's default, because
  `DocsRoot.astro` loads Plex Sans 700 and nothing sets `strong` to 600.
- `<DocCard>` puts its icon in a bordered tile and sizes its title at
  1.15rem.
- `<TierBadge>` is a pill around metadata.
- Most fences are not wrapped in a titled `<CodeBlock>`. `check:design` only
  checks the ones that are.
- Studio: Approvals are still bordered cards, Settings keeps its own section
  layout, and Branches and History use the older table styles.
- Studio: the editor chunk (Milkdown and CodeMirror, about 2.7 MB) loads with
  the app instead of when an entry opens.

## Verify before you hand off

1. Render it. Never claim a visual result from code alone.
2. Look at 1440px and 390px, in light and dark.
3. Check the first screen: is the next action obvious?
4. Run the reject list against what you see.
5. Check overflow (`scrollWidth` equals `clientWidth` at 390px), focus order,
   and contrast.
6. Does the Markdown twin carry the same facts?

`graft-verify` has the commands.

## Where corrections go

When a review finds a problem, fix it in the narrowest place that can enforce
it:

- A judgment call goes into this file, as a rule you can check.
- A repeated mechanic goes into `tokens.css` as a token, or into
  `src/components/mdx` as a component.
- Anything a machine can catch goes into a check (`check:design`, a lint rule,
  a test in `examples/docs-site`).
- Words go into the `graft-writing` skill.
- A one-off that appears once stays out of the rules until it repeats.

Changes to this file are reviewed like code.
