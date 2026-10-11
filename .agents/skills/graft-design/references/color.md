# Color

Graft's chrome is monochrome and its content carries the color: syntax, CLI
chips, brand marks and callouts. Both are easy to get wrong.

## Author in OKLCH

- Write palette values as `oklch(L C H)`. Equal steps in L look like equal
  steps in brightness, which is how the neutral ramp stays even.
- The neutral ramp is hue 95, chroma 0.002-0.006. Only L moves. Do not add a
  second neutral hue.
- Keep chroma inside sRGB unless you have checked P3 rendering. If a value
  looks clipped, lower C, not L.
- Literal colors live only in `packages/tokens/tokens.css`. Components read
  the semantic layer (`--foreground`, `--muted`, `--danger`).

## Themes

- Both themes follow the OS by default. A toggle sets `data-theme` on `html`
  and must win in both directions.
- Write light values on `:root`, dark values in
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
  and again in `:root[data-theme="dark"]`. Set `color-scheme` in each.
- Do not just invert. Dark surfaces step up in lightness (0, 0.17, 0.20,
  0.24); light surfaces step down from white.

## Contrast

Check with APCA against the real background, in both themes:

| Text | Minimum |
| --- | --- |
| Body and lede | Lc 75 |
| UI labels, buttons, table cells | Lc 60 |
| Metadata at 13px and up | Lc 60 |
| Placeholder and disabled | Lc 45, and never the only signal |

A danger red bright enough for body text on black turns pink, so error text
targets Lc 60 and always comes with an icon or the word "error".

## Adding a color

You almost never should. If you think you need one:

1. Name the meaning ("a queued approval"), not the hue.
2. Check whether brightness, weight, an icon or a word already says it.
3. If it still needs a hue, add a palette value and a semantic token in
   `tokens.css`, check contrast in both themes, and write the reason next to
   it. Then add a line to DESIGN.md.

Hue never marks success, a recommendation or "the good option".

## Syntax colors

Syntax colors match the Shiki `github-light` and `github-dark` themes the
site renders code with. CLI chips in prose reuse them: `--code-prompt` for
the binary, `--code-key` for the command, `--code-string` for flags,
`--code-comment` for arguments and `--code-type` for paths.

## Brand marks

Framework and tool marks keep their own colors. Check each in both themes:
a mark whose brand color disappears on one background (bun's cream, a black
Next.js circle) either uses `light-dark()` inside the SVG or switches to
`currentColor`.
