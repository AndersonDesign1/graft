# Review and verification

Use this to review someone else's UI or to check your own before you hand
it off.

## Look at the real thing

Render it. Code reading is not a visual review.

```sh
# docs site
# build what the site imports first (graft-verify, features/docs-site.md)
cd examples/docs-site && npx astro dev --background --port 4321 --host 127.0.0.1
for i in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:4321/docs/getting-started && break; sleep 1; done
curl -sf -o /dev/null http://127.0.0.1:4321/docs/getting-started || { npx astro dev logs; exit 1; }
agent-browser --color-scheme dark open http://127.0.0.1:4321/docs/getting-started
agent-browser set viewport 1440 900 && agent-browser screenshot desktop-dark.png
agent-browser set viewport 390 844 && agent-browser screenshot phone-dark.png
agent-browser eval "document.documentElement.scrollWidth === document.documentElement.clientWidth"
```

Then `agent-browser close` and repeat with `--color-scheme light` (the
scheme is fixed when the browser starts). Check keyboard focus with Tab.

## Checklist, in order

1. **First screen.** Is the next action obvious? Is the page's one claim or
   task visible without scrolling?
2. **Reject list.** Go through DESIGN.md's reject list item by item.
3. **Type.** Roles only, weights 400/500/600, no mono labels, no all caps,
   standalone lines at most 68ch, headings balanced; no text under 13px
   except 12px mono identifiers inside code frames.
4. **Space.** Every gap has one owner, the 4px grid holds, no accidental
   empty rectangles.
5. **Surfaces.** Each border or fill means something. No cards in cards.
6. **Color.** Chrome is monochrome. Hue appears only in syntax, CLI chips,
   brand marks, callout icons and labels, and danger. APCA passes in
   both themes.
7. **Motion.** Only the allowed list in DESIGN.md. Nothing on load, nothing on
   scroll. Reduced motion respected.
8. **Responsive.** No page overflow at 390px. Sidebar and rail collapse.
9. **Access.** Landmarks, one h1, focus visible, labels on icon buttons,
   tables with `scope`.
10. **Copy.** Run the `graft-writing` checklist.

## Reporting findings

Rank by impact on the reader:

| Rank | Means |
| --- | --- |
| P0 | Wrong facts, broken layout, unreadable, inaccessible |
| P1 | Breaks a DESIGN.md rule a reader will notice |
| P2 | Inconsistency between peers or pages |
| P3 | Polish |

One table, one row per finding:

| Rank | Where | Before | After | Rule |
| --- | --- | --- | --- | --- |
| P1 | `fumadocs.css` (example: the selectors for the sidebar group label and "On this page") | Labels set in Plex Mono | Plex Sans 13px 500, `--faint-foreground`, sentence case | DESIGN.md, Type: no mono labels |

Merge a systemic issue into one row and list every location. Say what you
did not inspect. Do not pad the list.
