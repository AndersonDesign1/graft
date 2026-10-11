---
name: graft-design
description: Design, build, polish or review anything a person sees in Graft, including the docs site, landing page, Studio, examples, social cards, SVG diagrams and animations. Use for layout, typography, color, tokens, components, motion, icons, dark mode, responsive work, accessibility and UI review. Triggers on "design", "make it look better", "feels off", "polish", "review this UI", CSS, Tailwind, tokens.css, MDX components, animation, transitions, OKLCH, contrast, fonts, spacing.
---

# Graft design

Graft's design language is in `DESIGN.md` at the repository root. It is the
authority. This skill tells you how to apply it and where the deeper
craft rules are.

## 1. Pick the mode from the request

| The user says | Mode | You do |
| --- | --- | --- |
| "design", "propose", "how should" | **Shape** | Write a short brief and one composition. No code until it is agreed, unless asked |
| "build", "add", "implement" | **Build** | Smallest change that follows DESIGN.md, then verify |
| "review", "audit", "what's wrong" | **Review** | Findings only, ranked. Do not edit |
| "polish", "feels off", "tighten" | **Polish** | Detail fixes inside the existing composition. No redesign |
| "write", "copy", "reword" | Use `graft-writing` instead | |

A review never turns into edits, and a polish never turns into a redesign.

## 2. Load in this order

1. `DESIGN.md` (always, the whole file).
2. The code that owns the surface: `packages/tokens/tokens.css`,
   `examples/docs-site/src/styles/*`, the component you are touching.
3. Only the references the task needs:

| Task touches | Read |
| --- | --- |
| Components, surfaces, radius, shadows, hit areas, icons | [references/interface.md](references/interface.md) |
| Any transition, animation or SVG motion | [references/motion.md](references/motion.md) |
| Fonts, type scale, wrapping, numbers, code type | [references/typography.md](references/typography.md) |
| Colors, tokens, contrast, dark mode | [references/color.md](references/color.md) |
| A review, or verifying your own work | [references/review.md](references/review.md) |

Do not read the reference files you do not need. They are split so you don't
have to.

## 3. Rules that override everything else

- Use tokens and the existing components of the surface you are on. A
  literal color, size or radius in component CSS is a bug. `pnpm
  check:design` catches colors in the docs stylesheet only; check sizes,
  radii and other surfaces by reading.
- DESIGN.md's full rules apply to the docs. The landing page and Studio keep
  their current look until they are rebuilt: on those, use their tokens and
  components and apply the rules only to what you add.
- Express the change in the project's styling system (plain CSS in the docs
  site, the existing approach in Studio). Never add a second one.
- Before inventing a component, check DESIGN.md's primitive list and
  `examples/docs-site/src/components/mdx/`.
- Facts on the page come from source: run the command, read the package,
  copy the error code. Never write a plausible-looking command.
- Shipped code is evidence, not precedent. If existing code breaks a rule in
  DESIGN.md, follow DESIGN.md and say so.

## 4. Build workflow

1. **Frame.** Who opens this page, to do what? What single thing should the
   first screen prove? Write it down in one sentence.
2. **States.** List every state the change can be in: loading, empty, error,
   long content, narrow screen, both themes, keyboard focus.
3. **Decide, then decorate.** Choose the composition from the material (a
   sequence, a comparison, a transcript) before any styling.
4. **Implement** the smallest coherent change.
5. **Verify** with [references/review.md](references/review.md): render it,
   1440px and 390px, light and dark. Use `agent-browser` (or Playwright) for
   screenshots; for the docs site run `npx astro dev --background` in
   `examples/docs-site`.
6. **Report** what you changed and what you saw. Never claim a visual result
   you did not render.

## 5. When DESIGN.md is silent

Pick the quieter option (in Build or Polish, implement it; in Shape or
Review, recommend it) and say in your summary that DESIGN.md has no rule for
it, with the rule you would propose. Do not edit DESIGN.md
unless the user asked you to; propose the change instead.
