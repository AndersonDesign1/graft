/**
 * The docs' MDX component map — every component authored bodies may use.
 * Mirrors the generated components/mdx-components.ts pattern from the Next
 * example; grows as `graft add` primitives land in this project.
 *
 * Everything here renders to static HTML in `renderMdx`, so none of it ships
 * client JavaScript. Tabs switch through a radio group rather than a handler,
 * and FieldTable reads the live schema at render time rather than at runtime.
 */
import { Callout } from "./Callout";
import { CodeBlock } from "./CodeBlock";
import { DocCard, DocCards } from "./DocCards";
import { FieldTable } from "./FieldTable";
import { InlineCode } from "./InlineCode";
import { Step, Steps } from "./Steps";
import { Tab, Tabs } from "./Tabs";
import { TierBadge } from "./TierBadge";

export const mdxComponents = {
  Callout,
  CodeBlock,
  DocCard,
  DocCards,
  FieldTable,
  Step,
  Steps,
  Tab,
  Tabs,
  TierBadge,
  code: InlineCode,
};
