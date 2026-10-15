---
"@usegraft/compiler": patch
---

A save no longer turns a one-line string into a folded `>-` block. js-yaml wrapped any string longer than 80 columns, so editing a long `description` rewrote it across three lines. Strings now stay on one line, and an edited one-line string keeps the quotes it had (`"…"` or `'…'`).

A frontmatter that opens with a comment is now patched key by key like any other, instead of being rewritten whole, which dropped the comment, re-quoted every string and lost the blank line after `---`. Comments and blank lines between keys stay put when the key above them changes.
