# Motion

Graft's default is stillness; this file is for the few times motion earns its
place.

## Decide whether it animates at all

| How often a person sees it | Decision |
| --- | --- |
| Many times a day (search, tabs, keyboard actions, nav) | No animation |
| Often (hover, menus, copy) | 100-200ms, color, opacity or a small scale |
| Occasionally (dialogs, drawers, toasts) | Standard, up to 250ms |
| Rarely, and the user started it (a demo's "Run") | May be longer, and must explain a state change |

Every animation must answer "what does this explain?": where something came
from, that a state changed, or that the interface heard a press. "It looks
nice" is not an answer.

## Easing and duration

- Entering or exiting: `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`.
- Moving on screen: `--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)`.
- Hover color: plain `ease`.
- Never `ease-in` for UI: it delays the moment the user is watching.
- UI stays under 300ms. Exits are faster than enters (150ms in, 100ms out).

## Patterns Graft uses

```css
/* Press */
button { transition: scale var(--duration-press) var(--ease-out); }
button:active { scale: var(--press-scale); }

/* Menu: from its trigger, never from scale(0) */
[role="menu"] { transform-origin: top right; transition: opacity 150ms var(--ease-out), scale 150ms var(--ease-out); }
[role="menu"][hidden] { display: block; opacity: 0; scale: 0.97; visibility: hidden; transition-duration: 100ms; }

/* Icon swap: both icons in the DOM, cross-fade */
.icon { transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1), scale 200ms cubic-bezier(0.2, 0, 0, 1), filter 200ms cubic-bezier(0.2, 0, 0, 1); }
.icon[data-hidden] { opacity: 0; scale: 0.25; filter: blur(4px); }
```

- Use CSS transitions for anything a user can interrupt. Keyframes only for a
  sequence that runs once to the end.
- `@starting-style` for enter transitions of elements added to the DOM.
- Never animate from `scale(0)`. Start at 0.95-0.97 with opacity.
- Stagger only for a rare, user-started reveal, 40-60ms per item, at most
  five items.

## SVG diagrams

Diagrams explain structure (the compile loop, branching, the approval gate).
They are static by default.

- Author with a `viewBox`, `currentColor` for strokes, and token colors
  through CSS so both themes work. Give every shape an explicit `fill`.
- Text in SVG uses the page's font and at least 13px at rendered size.
- A path may "draw" (`stroke-dasharray` and `stroke-dashoffset`) only when
  the reader triggers it and the drawing shows a real order.
- Always provide the same information as text nearby or as a `<title>` and
  `<desc>`.

## Never

Scroll-triggered reveals, typing effects, blinking cursors, marquees,
parallax, bounce or spring overshoot, page-load choreography, looping
ambient motion, motion that is the only signal of a change.

## Accessibility

Wrap motion in `@media (prefers-reduced-motion: no-preference)` or neutralize
it under `reduce`. A reduced-motion user gets the final state, instantly.

## Debugging

Slow the animation down (DevTools Animations panel at 10%) and step through
every state. What looks wrong slow is subtly wrong at full speed.
