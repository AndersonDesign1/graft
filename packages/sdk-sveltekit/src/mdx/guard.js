// A second check at render, for a tree that did not come from prepareMdx: one
// stored, edited or built by hand. prepareMdx refuses these at parse time;
// here they are dropped, so MdxContent never puts a script on the page. The
// lists match @usegraft/mdx-safety's.

/** Elements that can load or run code. They render as nothing. */
const SCRIPTING = new Set(["script", "iframe", "object", "embed", "frame", "frameset", "base"]);

/** `on…` handlers, and attributes a renderer may treat as raw HTML. */
const UNSAFE_ATTRIBUTE = /^(on[a-z]|innerhtml$|outerhtml$|dangerouslysetinnerhtml$)/i;

/** @param {string} tag */
export function renderable(tag) {
  return !SCRIPTING.has(tag.toLowerCase());
}

/**
 * @param {Readonly<Record<string, string | number | boolean>>} props
 * @returns {Record<string, string | number | boolean>}
 */
export function safeProps(props) {
  return Object.fromEntries(Object.entries(props).filter(([name]) => !UNSAFE_ATTRIBUTE.test(name)));
}
