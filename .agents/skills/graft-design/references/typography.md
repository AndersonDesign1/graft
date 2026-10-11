# Typography

The roles and sizes are in DESIGN.md; this file covers how to set them well.

## Faces

- IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500, self-hosted through
  `@fontsource` in the apps. `font-display: swap`, with a metric-close
  fallback stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`).
- Load only the weights in use. No 300, 650 or 700.
- `-webkit-font-smoothing: antialiased` on the root.

## Setting text

- Use a role token for size, leading and tracking together. Never set one
  without the other two.
- Tighter tracking as size grows: about -0.045em at display, -0.03em at title,
  -0.02em at section, 0 at body. Never positive tracking, since nothing is
  uppercase.
- Body leading 1.7 for reading, 1.5 for compact UI text, 1.0-1.15 for display.
- `text-wrap: balance` on headings, `pretty` on paragraphs. Check the last
  line of every large heading; fix a stranded word by rewriting, not by
  shrinking one heading.
- Measure: 60-68 characters for prose.
- Use a non-breaking hyphen (`&#8209;`) in short display phrases that must not
  break at the hyphen ("agent&#8209;native").

## Numbers and code

- `font-variant-numeric: tabular-nums` for tables, counters, versions in
  columns, and anything that updates.
- Inline code: mono at 0.875em, sunken background, hairline border. A
  command (one that starts with `graft`, `npx`, `pnpm` and the like) takes
  the terminal's hues; any other inline code stays
  monochrome.
- Code blocks: 13.5px, leading 1.7, `tab-size: 2`, horizontal scroll inside
  the block, never wrap code.
- Mono only for the literal: in "Run `graft compile` again", only
  `graft compile` is mono.

## Hierarchy

Build hierarchy with size, weight and space first, then color. Two headings
of the same level look the same everywhere. A label, a value and a detail
keep the same roles in every peer.

## Links

Underline with `text-decoration-thickness: 1px`, `text-underline-offset:
0.2em`, the color at `--border-strong`, becoming `currentColor` on hover.
Links in prose are 500 weight.

## Details

- Straight quotes in source files. Typographic quotes only where a renderer
  converts them, never typed by hand.
- Use the real ellipsis character, the real multiplication sign (1440×900) and
  non-breaking spaces between a number and its unit.
- `::selection` uses `--primary` and `--primary-foreground`.
- Inputs are 16px on touch devices so iOS does not zoom.
