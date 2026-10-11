---
"@usegraft/tokens": minor
---

The light scheme moves from ivory to chalk paper. `--paper-0` is now `oklch(0.992 0.002 95)` (about `#fdfcfb`) and `--paper-2` is `oklch(0.966 0.003 95)` (about `#f4f4f1`), on the same warm hue as the ink, so light mode reads white without going cold. Light borders are lighter to match (`--border` 0.11, `--border-strong` 0.24). Dark mode does not change. Anything that reads `--paper`, `--background` or `--border`, including Studio's light preview, picks this up with no code change.

New type-role tokens set size, leading and tracking together: `--type-title`, `--type-section`, `--type-subsection`, `--type-lede` and `--type-meta`, each with its `--leading-*` and, for headings, `--tracking-*`. `--weight-regular`, `--weight-medium` and `--weight-semibold` name the only three weights in use.
