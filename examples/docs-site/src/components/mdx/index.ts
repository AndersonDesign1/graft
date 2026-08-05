/**
 * The docs' MDX component map — every component authored bodies may use.
 * Mirrors the generated components/mdx-components.ts pattern from the Next
 * example; grows as `graft add` primitives land in this project.
 */
import { Callout } from "./Callout";
import { DocCard, DocCards } from "./DocCards";
import { InlineCode } from "./InlineCode";

export const mdxComponents = { Callout, DocCard, DocCards, code: InlineCode };
