/**
 * @usegraft/sdk-react/mdx: render an MDX body that `prepareMdx` prepared on
 * the server, with React.
 *
 * The tree is plain JSON (see `@usegraft/mdx-safety/tree`), so it travels in
 * a loader's data and renders the same on the server and when the page
 * hydrates. Nothing in it is evaluated: text is text, HTML elements are
 * elements, and a component the body names renders only if `components` has
 * it under that name. When `components` lacks it, its content renders
 * without the wrapper.
 *
 * Its own entry, so a page that imports it pulls in no Markdown parser and no
 * server code. `prepareMdx` comes from the server side of your framework's
 * adapter, such as `@usegraft/sdk-react-router/server`.
 */
import {
  renderable,
  safeProps,
  type MdxNode,
  type MdxPropValue,
  type MdxTree,
} from "@usegraft/mdx-safety/tree";
import {
  createElement,
  Fragment,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

export type { MdxNode, MdxTree };

/** Components the MDX body may use, by the name it uses them under. */
// Any props: each component declares its own, and the body passes literal strings.
export type MdxComponents = Record<string, ComponentType<any>>;

export interface MdxContentProps {
  /** What `prepareMdx` returned. An empty tree renders nothing. */
  tree: MdxTree;
  /** Components the body names, such as `{ Callout }`. */
  components?: MdxComponents;
}

/** HTML elements that cannot hold content; React refuses children on them. */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * The tree carries HTML attribute names. These are the ones React spells
 * differently; `aria-*` and `data-*` keep their names.
 */
const REACT_NAME: Record<string, string> = {
  "accept-charset": "acceptCharset",
  accesskey: "accessKey",
  allowfullscreen: "allowFullScreen",
  autocapitalize: "autoCapitalize",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  charset: "charSet",
  class: "className",
  colspan: "colSpan",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  datetime: "dateTime",
  enctype: "encType",
  enterkeyhint: "enterKeyHint",
  fetchpriority: "fetchPriority",
  for: "htmlFor",
  formaction: "formAction",
  formnovalidate: "formNoValidate",
  frameborder: "frameBorder",
  hreflang: "hrefLang",
  "http-equiv": "httpEquiv",
  inputmode: "inputMode",
  itemprop: "itemProp",
  itemscope: "itemScope",
  itemtype: "itemType",
  maxlength: "maxLength",
  minlength: "minLength",
  nomodule: "noModule",
  novalidate: "noValidate",
  playsinline: "playsInline",
  readonly: "readOnly",
  referrerpolicy: "referrerPolicy",
  rowspan: "rowSpan",
  spellcheck: "spellCheck",
  srcdoc: "srcDoc",
  srclang: "srcLang",
  srcset: "srcSet",
  tabindex: "tabIndex",
  usemap: "useMap",
};

/** The declarations of a style attribute, split on `;` outside quotes and parentheses. */
function declarations(css: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (const char of css) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === ";" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

/** `color: red; font-size: 2em` as React's style object. */
function styleObject(css: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of declarations(css)) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!name || !value) continue;
    // Custom properties keep their name; the rest are camelCased.
    const key = name.startsWith("--")
      ? name
      : name.toLowerCase().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[key] = value;
  }
  return style;
}

function elementProps(props: Readonly<Record<string, MdxPropValue>>, key: number) {
  const out: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(safeProps(props))) {
    if (name === "style" && typeof value === "string") out.style = styleObject(value);
    else out[REACT_NAME[name.toLowerCase()] ?? name] = value;
  }
  return out;
}

function renderNodes(nodes: readonly MdxNode[], components: MdxComponents): ReactNode[] {
  return nodes.map((node, key) => {
    if (node.type === "text") return node.value;
    if (node.type === "element") {
      if (!renderable(node.tag)) return null;
      // A tag in capitals (`BR`) is an HTML name, which React wants lowercase.
      // Mixed case is SVG (`linearGradient`, `foreignObject`) and stays as written.
      const tag = node.tag === node.tag.toUpperCase() ? node.tag.toLowerCase() : node.tag;
      const children = VOID.has(tag) ? [] : renderNodes(node.children, components);
      return createElement(tag, elementProps(node.props, key), ...children);
    }
    const children = renderNodes(node.children, components);
    const Custom = Object.hasOwn(components, node.name) ? components[node.name] : undefined;
    if (!Custom) return createElement(Fragment, { key }, ...children);
    return createElement(Custom, { ...safeProps(node.props), key }, ...children);
  });
}

/**
 * Render a body `prepareMdx` prepared on the server. As a second line, this
 * drops `<script>`-like elements, `on…` handlers and `innerHTML`-style
 * attributes from any tree it is given. It does not filter URLs: that is
 * `prepareMdx`'s job, so pass trees that came from it.
 */
export function MdxContent({ tree, components = {} }: MdxContentProps): ReactElement {
  return createElement(Fragment, null, ...renderNodes(tree, components));
}
