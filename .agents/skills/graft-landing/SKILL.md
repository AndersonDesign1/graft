---
name: graft-landing
description: Plan, design, write and preview a Graft marketing page, such as the landing page, Why, Security, Studio or Agents. Covers research on reference sites, the content inventory, building two or three directions, the page rules the landing page settled on, plain marketing copy for technical and non-technical readers, motion, real brand marks, the live Studio demo, and getting a preview to the user before anything is pushed. Use for "landing page", "marketing page", "hero", "redesign the site", "make it look like Linear or Vercel", "new page for Studio or Agents", or any page outside /docs and Studio.
---

# Graft marketing pages

A marketing page sells Graft to two readers at once: a developer, and a
person who never opens a terminal. It is not a docs page with bigger type.
This skill is the process and the rules the landing page settled on, so the
next page starts where that one ended.

`graft-design` and `DESIGN.md` still own tokens, type faces and
accessibility. `graft-writing` still owns the voice. This skill adds what a
marketing page needs on top of both.

## The order of work

Do these in order. Each ends in something the user can look at.

1. **Inventory first.** List what the page must say before you design
   anything: read the page it replaces, `README.md`, `CONTEXT.md` and the docs
   it will link to. Write the list as sections with the fact each one carries
   and where the fact comes from. A redesign that drops content the old page
   had is a regression: keep every section unless the user agrees to cut it.
   → [references/content.md](references/content.md)
2. **Research.** Render the current page and four to six reference sites the
   user names, measure them, and say in one screen what the current page
   lacks. Do it yourself, in this session. Do not fan out agents unless the
   user asks. → [references/research.md](references/research.md)
3. **Two or three directions.** Build each as a hero and two sections on its
   own route under `/lab`, never over the live page. The user picks parts,
   not a winner, so make the directions differ in kind.
4. **One page.** Compose the chosen parts and every section from the
   inventory. → [references/page-rules.md](references/page-rules.md)
5. **Copy.** Rewrite every line for a reader who has never heard of Graft.
   → [references/copy.md](references/copy.md)
6. **Preview, then wait.** Give the user a link they can open. Commit
   locally. Do not push until they say so.
   → [references/preview.md](references/preview.md)
7. **Section by section.** After the first full preview, work one section at
   a time, starting with the nav and the hero.

Ask when a decision is the user's: which direction, what proof exists
(stars, customers, quotes), what a section may drop. Do not ask what you can
settle by rendering two versions.

## Rules the user has already decided

These came from corrections. Do not reopen them without being asked.

- **It is a marketing page.** Lead with what the reader gets. Code appears as
  a picture of the product, never as the explanation.
- **Hero.** The headline is two lines, set large, in a block on the left of
  the page, not centered and not full width. Under it, one wide window of the
  real product runs the width of the page and is cut by the fold. No logo row
  and no feature list in the hero.
- **Agents get their own band** directly under the hero, with the current
  marks. Not in the hero, and not inside tab labels.
- **Stack marks.** Every framework, host, database and agent named on the
  page sits beside its real mark.
- **For agents and for people.** One section with a switch, two equal tabs
  with plain labels. Each side says what that reader gets and shows the real
  surface: an MCP exchange for agents, Studio for people.
- **Show the product live.** Studio is the real bundle on recorded data, not
  a screenshot. Product windows sit on a tray, never on the bare page.
- **Motion is part of the brief.** The headline rises by line, product
  windows peel up from their lower edge, belts of marks drift, and tabbed
  steps advance by themselves until the reader picks one. All of it stops
  for `prefers-reduced-motion` and the page is complete without script.
- **Both schemes, following the system.**
- **The docs' faces and Graft's tokens.** No new font, no accent color.
- **Facts come from the project.** Commands, output and error text are
  copied from a real run. Marks are the vendors' own files.

## Before you say it is done

- Rendered at 1440px and 390px, light and dark, and looked at.
- No sideways scroll from 320px to 1440px.
- Every interaction driven once: switches, tabs, copy buttons, the live
  Studio, the approval.
- Reduced motion: nothing hidden, nothing moving.
- `pnpm format:check`, `pnpm lint`, `pnpm check:design`,
  `pnpm --filter docs-site typecheck`, `pnpm --filter docs-site build`,
  `pnpm check:site`, `pnpm --filter docs-site test`, all through
  `graft-verify`'s `offline.sh`.
- The copy read once as someone who has never heard of Graft.
- The preview link sent, and the push held.
