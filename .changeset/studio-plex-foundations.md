---
"@usegraft/studio": minor
---

Studio now uses the docs' type, color and icons. IBM Plex Sans and Plex Mono
replace Geist and Instrument Serif, and mono is kept for identifiers (a slug,
a path, a field name) instead of labels. Labels are sentence case with no
letter-spacing, nothing is under 13px, and weights are 400, 500 and 600.

Color follows the docs' rule, monochrome chrome and colorful content: states
are a mark and a word on the neutral ramp, amber is kept for something waiting
on a person, red for errors and deletes, and diffs keep their code colors.
Collections are marked by an icon in the text color, not a tinted tile.

Icons are Lucide, at 16px and a 1.75 stroke, as in the docs. If you embed
`@usegraft/studio/panels`, install `lucide-react` in place of
`@phosphor-icons/react`; it is the optional peer the panels now import.
