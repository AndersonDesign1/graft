# Review with three outside lenses

Three published skills review a page from angles Graft's own skills do not.
None of them is installed here. Fetch each one fresh into the scratchpad,
read it as reference material, and apply its rules by hand in Graft's own
system. Do not run their scripts or adopt their role-play, and do not copy
their text into this repository.

| Lens | Where it is | Use it for |
| --- | --- | --- |
| `review-animations` by Emil Kowalski | `github.com/emilkowalski/skills`, `skills/review-animations` (`SKILL.md` and `STANDARDS.md`) | Every transition and animation |
| `make-interfaces-feel-better` by Jakub Krehel | `github.com/jakubkrehel/make-interfaces-feel-better` | Radii, shadows, hit areas, text wrapping, icons |
| `better-ui`, `better-typography`, `better-layout`, `better-colors` by Jakub Krehel | `github.com/jakubkrehel/skills` | Each has a table of patterns to search the stylesheet for |
| Nudge by Shift Nudge | Not on skills.sh. The user supplies it as a zip, or it is at shiftnudge.com/skill | The composition: type, grid, order, restraint |

`https://skills.sh/api/search?q=<words>` finds a skill and names its
repository. Check an author's other skills there before reviewing; a newer
one may replace an older one.

## Watch the motion at one-tenth speed

Both animation skills require it. With Playwright:

```js
const cdp = await context.newCDPSession(page);
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
```

Then load the page, screenshot every second or two, and look at the frames:
entrances that overlap, an edge that cuts through a window, text clipped
mid-rise, two things moving at once.

## What they caught on the landing page

Fix these classes of problem before asking for the review:

- A switch or tab the reader clicks animated for 600ms. An interaction stays
  under 300ms; only entrances seen once may run longer.
- Hover lifts fired on touch. Gate hover motion behind
  `@media (hover: hover) and (pointer: fine)`.
- A looping highlight that stepped through a row of logos explained nothing
  and animated paint on every frame. Constant motion is a belt, at linear
  speed, and it pauses under the pointer.
- A 28px button in a window bar. Extend its hit area to 40px with a
  pseudo-element.
- Two bands in a row with the same heading-and-lead shape. Merge them.
- Hover colors stuck on after a tap. Every `:hover` rule sits inside the
  same hover media query, not only the ones that move.
- A scheme toggle cross-faded every color on the page. Turn transitions off
  for the frame in which the scheme changes.
- A text field under 16px made iOS zoom the page on focus.
- An anchor link landed under the fixed nav. Set `scroll-padding-top`.
- At one-tenth speed, a transcript started playing while its tray was still
  peeling open. An entrance inside another waits for the outer one.
- A headline larger than the page needed. Size is not the only way to give
  the first thing the most weight.

## What was considered and left alone

- Fully concentric radius on a tray (window radius plus tray padding) gives
  a 42px corner, which is not Graft's squared shape. The tray keeps a small
  step over the window.
- Reduced motion turns every entrance off here instead of keeping fades.
  The page is complete at rest, so nothing is lost.

## Report

Say which lens found what, what you changed, and what you rejected with the
reason. Do not pad the list.
