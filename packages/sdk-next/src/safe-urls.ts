/**
 * Links and sources in restricted MDX can only go somewhere ordinary.
 *
 * `assertSafeMdx` refuses what runs code when the body is compiled. A URL is
 * different: `[Read more](javascript:alert(document.cookie))` is plain
 * Markdown, compiles to an ordinary link, and runs when a visitor clicks it.
 * React 19 blocks `javascript:` URLs, and React 18, which the Pages Router
 * can run on, renders them as they are. So under restricted trust a URL
 * attribute keeps its value only if it is relative or uses http, https,
 * mailto or tel, on Markdown links and on JSX elements and components alike.
 */

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/** Attributes that hold a URL, as hast and MDX JSX name them, lowercased with `-` and `:` removed. */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "cite",
  "background",
  "ping",
  "xlinkhref",
]);

/** Whether a URL is relative or uses a scheme that only navigates. */
export function isSafeUrl(value: string): boolean {
  // Browsers ignore whitespace and control characters inside a URL's scheme,
  // so `java\tscript:` is still javascript.
  let cleaned = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x20 && code !== 0x7f) cleaned += char.toLowerCase();
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned)?.[1];
  return scheme === undefined || SAFE_SCHEMES.has(scheme);
}

function safeValue(name: string, value: string): boolean {
  if (name !== "srcset") return isSafeUrl(value);
  return value.split(",").every((candidate) => isSafeUrl(candidate.trim().split(/\s+/)[0] ?? ""));
}

const urlName = (name: string) => name.toLowerCase().replace(/[-:]/g, "");

interface Node {
  type: string;
  children?: Node[];
  properties?: Record<string, unknown>;
  attributes?: Array<{ type: string; name?: string; value?: unknown }>;
}

function clean(node: Node): void {
  if (node.type === "element" && node.properties) {
    for (const [name, value] of Object.entries(node.properties)) {
      const key = urlName(name);
      if (!URL_ATTRIBUTES.has(key)) continue;
      const text = Array.isArray(value) ? value.join(key === "srcset" ? ", " : " ") : value;
      if (typeof text === "string" && !safeValue(key, text)) delete node.properties[name];
    }
  }
  if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.attributes) {
    node.attributes = node.attributes.filter((attribute) => {
      if (attribute.type !== "mdxJsxAttribute" || !attribute.name) return true;
      const key = urlName(attribute.name);
      if (!URL_ATTRIBUTES.has(key) || typeof attribute.value !== "string") return true;
      return safeValue(key, attribute.value);
    });
  }
  for (const child of node.children ?? []) clean(child);
}

/** The rehype plugin: drops every URL attribute that isn't safe. */
export function rehypeSafeUrls() {
  return (tree: Node) => clean(tree);
}
