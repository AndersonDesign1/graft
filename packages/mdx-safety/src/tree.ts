/**
 * @usegraft/mdx-safety/tree: the shape of a prepared MDX body, and the guard
 * every renderer of one applies.
 *
 * `prepareMdx` (from `@usegraft/mdx-safety/prepare`) parses a body into this
 * tree on the server. Each framework's `MdxContent` renders it: Svelte, React
 * and Astro alike. Nothing in the tree is evaluated, so a renderer needs no
 * MDX compiler and no `new Function`.
 *
 * Safe to import in the browser: this file has no dependencies.
 */

/** An attribute value the tree carries. `true` is an attribute with no value. */
export type MdxPropValue = string | number | boolean;

/** One node of a prepared body. */
export type MdxNode =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "element";
      /** An HTML element name, such as `p`, `a` or `table`. */
      readonly tag: string;
      readonly props: Readonly<Record<string, MdxPropValue>>;
      readonly children: readonly MdxNode[];
    }
  | {
      readonly type: "component";
      /** The name the body uses, such as `Callout`, looked up in `components`. */
      readonly name: string;
      readonly props: Readonly<Record<string, MdxPropValue>>;
      readonly children: readonly MdxNode[];
    };

/** A prepared body: what `prepareMdx` returns and `MdxContent` renders. */
export type MdxTree = readonly MdxNode[];

/*
 * A second check at render, for a tree that did not come from prepareMdx: one
 * stored, edited or built by hand. prepareMdx refuses these at parse time;
 * a renderer drops them, so MdxContent never puts a script on the page.
 */

/** Elements that can load or run code. They render as nothing. */
const SCRIPTING = new Set(["script", "iframe", "object", "embed", "frame", "frameset", "base"]);

/** `on…` handlers, and attributes a renderer may treat as raw HTML. */
const UNSAFE_ATTRIBUTE = /^(on[a-z]|innerhtml$|outerhtml$|dangerouslysetinnerhtml$)/i;

/** An HTML or custom element name. Anything else (`script `, `a b`) is refused. */
const ELEMENT_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/i;

/** Whether an element may render at all: a plain element name that cannot run code. */
export function renderable(tag: string): boolean {
  return ELEMENT_NAME.test(tag) && !SCRIPTING.has(tag.toLowerCase());
}

/** An attribute name with nothing a renderer could write as markup around it. */
const ATTRIBUTE_NAME = /^[a-z_:][a-z0-9_.:-]*$/i;

/** The props without handlers, raw-HTML attributes, or names that are not attribute names. */
export function safeProps(
  props: Readonly<Record<string, MdxPropValue>>,
): Record<string, MdxPropValue> {
  return Object.fromEntries(
    Object.entries(props).filter(
      ([name]) => ATTRIBUTE_NAME.test(name) && !UNSAFE_ATTRIBUTE.test(name),
    ),
  );
}
