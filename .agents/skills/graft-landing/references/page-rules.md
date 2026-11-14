# Page rules

Where these live in code: `examples/docs-site/src/styles/lab.css`,
`src/layouts/Lab.astro` and `src/components/lab/`. Reuse those components
before writing new ones.

## Layout

- One `.wrap` for the nav, every section and the footer, so the left and
  right edges never move.
- A section is one screen tall at 1440x900 (`.screen`). A band that only
  carries a heading and a row of marks is shorter (`.screen-short`). Check
  with `scripts/shoot-sections.cjs`, which prints every section's height.
- A split puts words on the left and the product on the right, every time.
- Display type: h1 up to 80px, h2 up to 52px, weight 500, tight tracking.
  The roles are the `--lab-*` custom properties at the top of `lab.css`.

## The hero

- Two lines, left block, wide but not full width.
- The lead is two or three short sentences a non-developer follows.
- Two actions: the install command as a copy button, and one link down the
  page.
- One wide product window under the words, on a tray, cut by the fold
  (`HeroWide.astro`). Nothing else.

## Product windows

- A window never sits on the bare page. It sits on a `.tray`: a sunken
  ground with the growth rings (`Rings.astro`) in the ink color.
- Prefer the live thing. `StudioFrame.astro` embeds the real Studio; an
  editable file, a transcript that replays, an approval the reader decides.
- A window bar has three neutral dots, a title, and at most one action.

## Marks

- Use `Mark.astro`. The files are in `src/components/lab/marks/` and come
  from `@lobehub/icons-static-svg` (agents, MIT) and `simple-icons` (stack,
  CC0). Framework marks already in `components/icons/FrameworkIcons.tsx` stay
  there.
- Never draw a logo, recolor one, or put one beside a name it does not stand
  for. If a product publishes no vector mark, use its own published icon
  file (T3 Code is a PNG from its site).
- When you add a mark, add its source to `public/third-party-notices.txt`.
- Check the list of agents against what people use today before reusing it.
  It lives in `src/components/lab/agents.ts`.

## Motion

Motion runs only when `<html>` has the class `motion`, which the layout adds
when script is on and the reader has not asked for reduced motion. Without
it the page is complete and still.

| Moment | How |
| --- | --- |
| Hero headline | Each line rises from behind its own edge, 120ms apart |
| A product tray | `data-peel`: the tray unclips from its lower edge and the window rides up, once, when first seen |
| Section words | `data-reveal`: children rise in order, once |
| Belts of marks | Two rows drift in opposite directions and stop under the pointer |
| The agents band | A light passes along the tiles, one at a time |
| Tabbed steps | They advance every five seconds while on screen; the active tab shows its progress; hovering holds it; choosing a step stops it |
| A switch | The side that arrives rises into place |

Rules that keep it from turning into noise:

- One entrance per element, ever. Nothing replays on scroll.
- A clipped element never counts as visible to an IntersectionObserver.
  Watch its parent (see the observer in `Lab.astro`).
- A loop pauses on hover and focus.
- An embedded app must not scroll the page that hosts it. The Studio demo's
  shim keeps `focus()` and `scrollIntoView()` inside the frame.
- Use `transform`, `opacity` and `clip-path`. Do not animate layout, and do
  not rotate a filtered SVG.
