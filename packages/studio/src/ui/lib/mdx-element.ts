/**
 * Read the shape of an MDX element out of its source, for display.
 *
 * Milkdown stores an unbroken JSX block as an inline `html` atom whose `value`
 * attribute is the raw source, so the canvas showed `<DocCards>…</DocCards>` as
 * literal angle-bracket text — the single ugliest thing in the editor, and on
 * the project's own documentation.
 *
 * This parser exists only to render that node as a card. It never rewrites the
 * source: the node keeps its exact bytes, so serialisation is unchanged and the
 * round trip stays byte-identical by construction. Which is also why it can
 * afford to be strict — anything it does not fully understand returns null and
 * the block falls back to showing its source, exactly as before. A wrong guess
 * would be worse than the soup; refusing is free.
 */

export interface MdxAttribute {
  name: string;
  /** Quoted string value, or the raw text of a `{…}` expression. */
  value: string;
  /** True for `{…}` expressions and bare boolean props, which are not strings. */
  expression: boolean;
}

export interface MdxElement {
  kind: "element";
  name: string;
  attributes: MdxAttribute[];
  children: MdxNode[];
  selfClosing: boolean;
}

export interface MdxText {
  kind: "text";
  value: string;
}

export type MdxNode = MdxElement | MdxText;

/** A component, not an HTML tag: MDX resolves capitalised names to components. */
const COMPONENT_NAME = /^[A-Z][\w.]*$/;
const NAME_START = /[A-Za-z_$]/;
const NAME_CHAR = /[\w.$-]/;

class Reader {
  index = 0;
  constructor(readonly source: string) {}

  get done(): boolean {
    return this.index >= this.source.length;
  }

  peek(offset = 0): string {
    return this.source[this.index + offset] ?? "";
  }

  startsWith(text: string): boolean {
    return this.source.startsWith(text, this.index);
  }

  skipSpace(): void {
    while (!this.done && /\s/.test(this.peek())) this.index += 1;
  }

  readName(): string | null {
    if (!NAME_START.test(this.peek())) return null;
    const start = this.index;
    this.index += 1;
    while (!this.done && NAME_CHAR.test(this.peek())) this.index += 1;
    return this.source.slice(start, this.index);
  }
}

/** Read a `{…}` expression, tracking nesting and strings so braces inside quotes don't end it. */
function readExpression(reader: Reader): string | null {
  if (reader.peek() !== "{") return null;
  const start = reader.index;
  let depth = 0;
  let quote = "";
  while (!reader.done) {
    const char = reader.peek();
    if (quote) {
      if (char === "\\") reader.index += 2;
      else {
        if (char === quote) quote = "";
        reader.index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        reader.index += 1;
        return reader.source.slice(start + 1, reader.index - 1);
      }
    }
    reader.index += 1;
  }
  return null; // unterminated
}

function readAttributes(reader: Reader): MdxAttribute[] | null {
  const attributes: MdxAttribute[] = [];
  for (;;) {
    reader.skipSpace();
    if (reader.done) return null;
    if (reader.peek() === ">" || reader.startsWith("/>")) return attributes;

    // Spread props carry no displayable name/value pair; refuse the element
    // rather than render a card that silently omits what it could not show.
    if (reader.startsWith("{")) return null;

    const name = reader.readName();
    if (!name) return null;
    reader.skipSpace();

    if (reader.peek() !== "=") {
      attributes.push({ name, value: "true", expression: true });
      continue;
    }
    reader.index += 1;
    reader.skipSpace();

    const char = reader.peek();
    if (char === '"' || char === "'") {
      const end = reader.source.indexOf(char, reader.index + 1);
      if (end === -1) return null;
      attributes.push({
        name,
        value: reader.source.slice(reader.index + 1, end),
        expression: false,
      });
      reader.index = end + 1;
      continue;
    }
    if (char === "{") {
      const expression = readExpression(reader);
      if (expression === null) return null;
      attributes.push({ name, value: expression.trim(), expression: true });
      continue;
    }
    return null;
  }
}

function readElement(reader: Reader): MdxElement | null {
  if (reader.peek() !== "<") return null;
  reader.index += 1;
  const name = reader.readName();
  if (!name || !COMPONENT_NAME.test(name)) return null;

  const attributes = readAttributes(reader);
  if (!attributes) return null;

  if (reader.startsWith("/>")) {
    reader.index += 2;
    return { kind: "element", name, attributes, children: [], selfClosing: true };
  }
  if (reader.peek() !== ">") return null;
  reader.index += 1;

  const children = readChildren(reader, name);
  if (!children) return null;
  return { kind: "element", name, attributes, children, selfClosing: false };
}

function readChildren(reader: Reader, parentName: string): MdxNode[] | null {
  const children: MdxNode[] = [];
  let text = "";
  const flush = (): void => {
    if (text.trim()) children.push({ kind: "text", value: text.trim() });
    text = "";
  };

  while (!reader.done) {
    if (reader.startsWith(`</${parentName}`)) {
      reader.index += parentName.length + 2;
      reader.skipSpace();
      if (reader.peek() !== ">") return null;
      reader.index += 1;
      flush();
      return children;
    }
    // A nested element starts only at `<` followed by a name; a stray `<` is text.
    if (reader.peek() === "<" && NAME_START.test(reader.peek(1))) {
      const child = readElement(reader);
      if (!child) return null;
      flush();
      children.push(child);
      continue;
    }
    // Expressions inside children ({count}, {/* comment */}) are not displayable
    // as themselves; refuse rather than drop them silently.
    if (reader.peek() === "{") return null;
    text += reader.peek();
    reader.index += 1;
  }
  return null; // never closed
}

/**
 * Parse a whole MDX block into one element, or null when the source is anything
 * other than a single fully-understood component (plain HTML, multiple roots,
 * spreads, embedded expressions, or malformed markup).
 */
export function parseMdxElement(source: string): MdxElement | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith("<")) return null;

  const reader = new Reader(trimmed);
  const element = readElement(reader);
  if (!element) return null;

  reader.skipSpace();
  // Trailing content means this block is not a single element; a card would
  // hide whatever followed it.
  return reader.done ? element : null;
}

export interface InlineToken {
  kind: "text" | "strong" | "code";
  value: string;
}

/**
 * The inline markdown a component's body can contain, as tokens.
 *
 * A card showing `**stateless**` looks unfinished, which defeats the point of
 * the card. Only the forms that actually appear in component bodies are
 * recognised; anything else stays text, so the worst case is exactly what the
 * card showed before. Display only — the block keeps its own source, so no
 * output of this function is ever written back to a file.
 *
 * `_emphasis_` is deliberately absent. This is a CMS for technical content,
 * where snake_case identifiers are everywhere (`content_index`, `data_records`),
 * and a lazy underscore pair happily matches across two of them — turning
 * "graft_add then graft_compile" into one italic run with the underscores
 * eaten. Missing an italic costs nothing; mangling an identifier misleads.
 */
const INLINE = /\*\*(.+?)\*\*|`([^`]+?)`|\[(.+?)\]\([^)]*\)/g;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  const push = (kind: InlineToken["kind"], value: string): void => {
    if (value) tokens.push({ kind, value });
  };
  for (const match of text.matchAll(INLINE)) {
    push("text", text.slice(last, match.index));
    const [, strong, code, link] = match;
    if (strong !== undefined) push("strong", strong);
    else if (code !== undefined) push("code", code);
    else if (link !== undefined) push("text", link);
    last = match.index + match[0].length;
  }
  push("text", text.slice(last));
  return tokens;
}

/** The text a card shows when a child element has no obvious label attribute. */
export function elementSummary(element: MdxElement): string {
  const text = element.children
    .filter((child): child is MdxText => child.kind === "text")
    .map((child) => child.value)
    .join(" ");
  return text.trim();
}
