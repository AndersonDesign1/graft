/**
 * @usegraft/mdx-safety/prepare: turn an MDX body into the tree every
 * framework's `MdxContent` renders (see `@usegraft/mdx-safety/tree`).
 *
 * The body is never compiled to code or run. It is parsed into a small tree
 * of text, HTML elements and components, which is plain JSON: it travels from
 * a server loader to the page in the framework's own data, and renders the
 * same on the server and in the browser.
 *
 * Because nothing is evaluated, `{expressions}`, `import`, `export` and
 * spread attributes are refused under every trust level, not only
 * "restricted". So are scripting elements and `on…` handlers, which the
 * browser would run from the rendered HTML. Call this where only the server
 * runs: it carries the Markdown parser.
 */
import { GraftError } from "@usegraft/contracts";
import { findExecutableMdx, UncheckableMdxError, type MdxTrust } from "./index";
import { rehypeSafeUrls } from "./render";
import type { MdxNode, MdxPropValue, MdxTree } from "./tree";
// Adds the MDX JSX nodes to mdast's types, for `passThrough` below.
import type {} from "mdast-util-mdx-jsx";
import { find, html } from "property-information";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype, { type Options as ToHastOptions } from "remark-rehype";
import { unified } from "unified";

export type { MdxNode, MdxPropValue, MdxTree, MdxTrust };

export interface PrepareMdxOptions {
  /**
   * Whether link and source URLs are filtered. `"restricted"` (the default)
   * keeps a URL only if it is relative or uses http, https, mailto or tel.
   * `"full"` keeps every URL. Expressions, imports and scripting are refused
   * either way, because this renderer never evaluates the body.
   */
  trust?: MdxTrust;
  /** What is being prepared, for error messages (e.g. "pages/home"). */
  label?: string;
}

const MDX_ELEMENTS = new Set(["mdxJsxFlowElement", "mdxJsxTextElement"]);

/** HTML elements that cannot hold content. `<br>text</br>` written as JSX loses the text. */
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

/** Keep MDX's JSX elements in the HTML tree; this file turns them into nodes. */
const TO_HAST: ToHastOptions = { passThrough: ["mdxJsxFlowElement", "mdxJsxTextElement"] };

/** The hast and MDX nodes this file reads, as loosely as the trees are typed. */
interface TreeNode {
  type: string;
  value?: unknown;
  tagName?: string;
  properties?: Record<string, unknown>;
  name?: string | null;
  attributes?: Array<{ type: string; name?: string; value?: unknown }>;
  children?: TreeNode[];
}

function refuse(found: string, where: string, details: Record<string, unknown>): never {
  throw new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: `This MDX body can't be rendered${where}: ${found}.`,
    fix: 'Write prose, Markdown and components with literal attributes, such as <Callout type="note">. MdxContent never runs the body, so `{…}` expressions, `import`, `export` and spread attributes are refused under every trust level, as are <script>-like elements and `on…` handlers. Pass components in MdxContent\'s `components` map instead of importing them.',
    details,
  });
}

function assertRenderable(source: string, label: string | undefined): void {
  const where = label ? ` (${label})` : "";
  let found: ReturnType<typeof findExecutableMdx>;
  try {
    found = findExecutableMdx(source);
  } catch (error) {
    if (!(error instanceof UncheckableMdxError)) throw error;
    refuse(`it could not be parsed (${error.message})`, where, { label, reason: error.message });
  }
  if (found.length === 0) return;
  const listed = found
    .slice(0, 5)
    .map((node) => `${node.kind}${node.line === undefined ? "" : ` on line ${node.line}`}`)
    .join(", ");
  refuse(`it contains ${listed}`, where, { label, found: found.length, nodes: found.slice(0, 20) });
}

/** A hast property as the HTML attribute a renderer sets, or nothing for false and empty values. */
function attribute(name: string, value: unknown): [string, MdxPropValue] | null {
  const info = find(html, name);
  if (value === false || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return [info.attribute, value.join(info.commaSeparated ? ", " : " ")];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [info.attribute, value];
  }
  return null;
}

function elementProps(properties: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(properties ?? {}).flatMap(([name, value]) => {
      const pair = attribute(name, value);
      return pair ? [pair] : [];
    }),
  );
}

/** A JSX element's literal attributes. Expressions were refused before parsing. */
function jsxProps(node: TreeNode, intrinsic: boolean) {
  return Object.fromEntries(
    (node.attributes ?? []).flatMap((item): [string, MdxPropValue][] => {
      if (item.type !== "mdxJsxAttribute" || !item.name) return [];
      const value = item.value === null || item.value === undefined ? true : item.value;
      if (typeof value !== "string" && value !== true) return [];
      if (!intrinsic) return [[item.name, value]];
      // An HTML element written as JSX: `className` is `class`, `htmlFor` is `for`.
      const pair = attribute(find(html, item.name).property, value);
      return pair ? [pair] : [];
    }),
  );
}

/**
 * Table parts whose whitespace text the HTML parser drops. Kept in the tree,
 * it would render on the server and be missing in the browser's DOM, which
 * React reports as a hydration mismatch.
 */
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup"]);

function childrenOf(tag: string, children: MdxNode[]): MdxNode[] {
  if (VOID.has(tag)) return [];
  if (!TABLE_PARTS.has(tag)) return children;
  return children.filter((child) => child.type !== "text" || child.value.trim() !== "");
}

function convert(nodes: TreeNode[] | undefined): MdxNode[] {
  const out: MdxNode[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text" && typeof node.value === "string") {
      out.push({ type: "text", value: node.value });
    } else if (node.type === "element" && node.tagName) {
      out.push({
        type: "element",
        tag: node.tagName,
        props: elementProps(node.properties),
        children: childrenOf(node.tagName, convert(node.children)),
      });
    } else if (MDX_ELEMENTS.has(node.type)) {
      const children = convert(node.children);
      if (!node.name) {
        // A fragment, `<>…</>`: its children stand in its place.
        out.push(...children);
        continue;
      }
      const intrinsic = /^[a-z]/.test(node.name) && !node.name.includes(".");
      out.push(
        intrinsic
          ? {
              type: "element",
              tag: node.name,
              props: jsxProps(node, true),
              children: childrenOf(node.name, children),
            }
          : { type: "component", name: node.name, props: jsxProps(node, false), children },
      );
    }
    // Comments, doctypes and anything else carry nothing to render.
  }
  return out;
}

/**
 * Prepare an MDX body for `MdxContent`. Empty source gives an empty tree. A
 * body with anything executable is refused with INPUT_VALIDATION_FAILED.
 */
export function prepareMdx(source: string, options: PrepareMdxOptions = {}): MdxTree {
  const trimmed = source.trim();
  if (trimmed.length === 0) return [];
  assertRenderable(trimmed, options.label);
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkRehype, TO_HAST);
  const restricted = (options.trust ?? "restricted") !== "full";
  const hast: TreeNode = processor.runSync(processor.parse(trimmed));
  if (restricted) rehypeSafeUrls()(hast);
  return convert(hast.children);
}
