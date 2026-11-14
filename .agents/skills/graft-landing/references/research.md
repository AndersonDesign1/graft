# Research

The point of research is a short, checkable statement of what the current
page lacks. Not a mood board.

## Capture

Chromium and Playwright are installed in cloud sessions. From any directory:

```sh
SK=.agents/skills/graft-landing/scripts
node $SK/capture-sites.cjs <out-dir> '[
  {"name":"linear","url":"https://linear.app/","max":6,"wait":6000},
  {"name":"vercel","url":"https://vercel.com/","max":5,"wait":6000}
]'
```

It saves one screenshot per screen and prints, for each site, the body
background, the font, and the size, weight, leading and tracking of the
first h1, h2 and paragraph. Capture the current Graft page the same way from
a local dev server.

Look at the screenshots. Numbers without looking produce a copy of someone
else's page.

## What to compare

- Heading sizes below the hero. The old Graft page had 24px section headings
  against 48 to 56px on every reference.
- What fills the hero: real product, and how much of the screen it takes.
- How many words a screen holds.
- Where color comes from.
- What moves, and what triggers it.
- Nav labels: case, face, size.

## What could not be done last time

- X and Twitter posts are behind a login and search engines return almost
  none of them. Say so instead of implying they were read.
- Apple's product pages redirect to a chooser. Use a specific product URL
  and check the capture before describing it.
- Third-party "design skills" found by search are mostly aggregator pages.
  If the user names one, fetch its `SKILL.md` and apply its rules by hand
  with Graft's tokens and faces. Do not run its generators, palette pickers
  or stop hooks: they replace the project's system.

## Report

Lead with the gaps in the current page, each one measured. Then a table of
the references, one row each. Then the directions you propose to build.
Name what you could not reach.
