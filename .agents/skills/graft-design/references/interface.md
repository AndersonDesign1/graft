# Interface details

Where anything here disagrees with DESIGN.md, DESIGN.md wins.

## Surfaces

- **Concentric radius.** Outer radius = inner radius + padding. A 6px button
  inside a container with 4px padding sits in a 10px container. Mismatched
  nested radii are the most common reason something "feels off".
- **Borders for structure, light for depth.** In dark, raise a surface by
  making it lighter (`--card`, `--elevated`), not by adding a shadow. Shadows
  only on floating layers (`--shadow-floating`).
- **Image outlines.** `outline: 1px solid var(--outline-image)` with
  `outline-offset: -1px`. Pure black or white at 10%, never a tinted gray.
- **Optical alignment.** Icons beside text and play/arrow glyphs often need
  1px of manual nudge. Check by eye at 200% zoom.
- **One surface per object.** A code block is one frame; its tabs and copy
  button live in its header. Do not frame the tabs separately.

## Controls

- **Hit areas.** At least 40x40px on desktop, 44x44px on touch. Extend a
  small control with a `::before` inset instead of growing its visual size.
  Hit areas never overlap.
- **Press feedback.** A small scale on `:active` over `--duration-press`
  (140ms) with `--ease-out`: 0.96 on pills, 0.98 on larger targets such as
  previous and next. Never below 0.95.
- **Primary is unmistakable.** One primary button per view. Everything else
  is the outline or ghost variant.
- **Page actions are pills.** Copy page, View as Markdown, Open in ChatGPT,
  Open in Claude, in one row under the lede. They wrap on narrow screens;
  they never fold into a menu.
- **Destructive actions** say verb plus noun ("Delete document"), never "OK"
  or "Confirm", and use `--danger` with an icon.
- **Menus** open from their trigger (`transform-origin` at the trigger),
  close on Escape and outside click, return focus to the trigger.
- **Tabs** switch instantly and support arrow keys. The docs build them as a
  radio group, so they work without JavaScript and are one tab stop.
- **Copy buttons** keep both icons in the DOM and show the check on success.
  Announce "Copied" through a live region (`role="status"` or `aria-live`);
  the button's own label names what it copies ("Copy code", "Copy prompt",
  "Copy page") and does not change. Catch clipboard errors and say "Copy
  failed".

## Icons

- Interface icons are Lucide. Stroke 1.75 in the docs chrome, 2 in callouts
  and steps.
- 16px in UI, 14px in the page-action pills and metadata rows.
- `currentColor`, states through color and opacity, outline by default and
  fill only for an active state.
- Every icon-only button has an `aria-label`.
- Framework and tool marks keep their own colors and sit beside their name
  (tabs, tables, next steps). Package-manager marks use `currentColor`.
- No icon tiles, no decorative icons beside headings, no emoji.

## States to design for

Every interactive surface needs: default, hover, focus-visible, active,
disabled, loading, empty, error, and very long content. If you cannot show
one of them, say so in your summary.

## Performance

- Never `transition: all`. List properties.
- `will-change` only for `transform`, `opacity` or `filter`, and only after
  you see first-frame jank.
- Animate `transform`, `opacity`, `filter`, `clip-path`. Do not animate
  `height`, `width`, `top` or `box-shadow` on large areas.
- Sticky headers with `backdrop-filter` are fine; do not stack two.
