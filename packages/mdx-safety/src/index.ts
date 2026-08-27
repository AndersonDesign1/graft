/**
 * Refusing executable MDX.
 *
 * MDX is code: `{expr}` evaluates JavaScript, `import` pulls modules in, and
 * `@mdx-js/mdx`'s `run()` evaluates the compiled body with `new Function` in
 * the host runtime — full `process`, `fetch`, and dynamic `import()`. For
 * content the operator wrote and reviewed in git, that is the feature.
 *
 * It stops being a feature the moment an author is not the operator. A hosted
 * Studio, or one a user runs for their own writers, makes "can write content"
 * a lower privilege than "can execute code on the render host" — and on shared
 * infrastructure that reaches other tenants.
 *
 * **Scope.** This refuses constructs that EXECUTE. It is not an HTML sanitiser:
 * it does not filter `javascript:` URLs, `style` attributes, `srcdoc`, or the
 * long tail of markup that can be abused without running script inline. If you
 * render content from people you do not trust at all, put a sanitiser
 * (rehype-sanitize) in the pipeline as well — this closes the MDX-specific hole
 * that a Markdown sanitiser would not even see.
 *
 * The approach here is to remove the executable surface rather than contain it.
 * `node:vm` is explicitly not a security boundary, and a worker thread cannot
 * hand React elements back across its boundary without breaking component
 * identity under RSC. What CAN be made safe is the input: prose, GFM and
 * components survive; everything that evaluates does not.
 */
import { GraftError } from "@usegraft/contracts";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/** One executable construct found in a body, with where it was. */
export interface ExecutableNode {
  /** What it is, in the reader's terms rather than the AST's. */
  kind:
    | "expression"
    | "import-or-export"
    | "attribute-expression"
    | "attribute-spread"
    | "scripting-element"
    | "event-handler";
  /** 1-based line, when the parser knew it. */
  line?: number;
  /** The offending source, truncated. */
  snippet?: string;
}

const KIND_LABEL: Record<ExecutableNode["kind"], string> = {
  expression: "a `{…}` expression",
  "import-or-export": "an `import` or `export`",
  "attribute-expression": "an attribute whose value is a `{…}` expression",
  "attribute-spread": "a `{...spread}` attribute",
  "scripting-element": "an element that can load or run code",
  "event-handler": "an inline event-handler attribute",
};

/**
 * Elements that execute or fetch on their own, with no `{}` in sight.
 *
 * `<script>alert(1)</script>` contains no expression, so the expression checks
 * above never see it — and MDX renders an unknown lowercase tag straight
 * through to HTML. Same for the elements that pull in a document or plugin.
 */
const SCRIPTING_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "base",
]);

/** `onerror`, `onload`, `onclick`, … — a string value still runs in a browser. */
const EVENT_HANDLER_RE = /^on[a-z]/i;

function snippetOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

// Must parse at least as much as the renderer does. `MdxBody` compiles with
// remark-gfm, so without it here a body could fail to parse for the checker
// (tables, footnotes, autolinks) while compiling fine for real — and the old
// "unparseable means nothing to execute" shortcut would wave it through.
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);

/** Thrown when the checker cannot parse a body, so it cannot vouch for it. */
export class UncheckableMdxError extends Error {
  constructor(readonly cause: unknown) {
    super("MDX could not be parsed for safety checking");
    this.name = "UncheckableMdxError";
  }
}

/**
 * Every executable construct in an MDX body, in source order.
 *
 * Returns them rather than throwing so a caller can report all of them at once
 * — an author fixing one at a time learns the rule slowly and resents it.
 *
 * Source the checker cannot parse throws {@link UncheckableMdxError}. It used
 * to return `[]` on the reasoning that "a body that will not parse cannot
 * execute either" — which only holds if this parser understands at least as
 * much as the one that renders. Two independently-configured parsers WILL
 * drift, and the failure mode of that shortcut is to wave through exactly the
 * source that sits in the gap. Refusing what we cannot read is the only
 * direction that stays safe when they diverge.
 */
export function findExecutableMdx(source: string): ExecutableNode[] {
  let tree;
  try {
    tree = processor.parse(source);
  } catch (error) {
    throw new UncheckableMdxError(error);
  }

  const found: ExecutableNode[] = [];

  /** The slice of an mdast node this check actually reads. */
  interface Visited {
    type: string;
    value?: unknown;
    attributes?: unknown[];
    position?: { start?: { line?: number } };
  }

  const at = (node: Visited): number | undefined => node.position?.start?.line;

  visit(tree, (node: Visited) => {
    if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
      found.push({ kind: "expression", line: at(node), snippet: snippetOf(node.value) });
      return;
    }
    if (node.type === "mdxjsEsm") {
      found.push({ kind: "import-or-export", line: at(node), snippet: snippetOf(node.value) });
      return;
    }
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const tag = (node as { name?: unknown }).name;
      if (typeof tag === "string" && SCRIPTING_ELEMENTS.has(tag.toLowerCase())) {
        found.push({ kind: "scripting-element", line: at(node), snippet: `<${tag}>` });
      }
      for (const attribute of (node.attributes ?? []) as Array<{
        type: string;
        name?: string;
        value?: unknown;
      }>) {
        // `<Foo {...props} />` — the spread is an expression.
        if (attribute.type === "mdxJsxExpressionAttribute") {
          found.push({
            kind: "attribute-spread",
            line: at(node),
            snippet: snippetOf(attribute.value),
          });
          continue;
        }
        // `<Foo bar={process.env.X} />` — a literal string value is fine, an
        // expression container is not.
        // An inline handler is executable whether or not its value is an
        // expression: React renders an unrecognised `onerror="…"` straight into
        // the HTML, where the browser runs it.
        if (typeof attribute.name === "string" && EVENT_HANDLER_RE.test(attribute.name)) {
          found.push({
            kind: "event-handler",
            line: at(node),
            snippet: snippetOf(attribute.name),
          });
          continue;
        }
        const value = attribute.value as { type?: string; value?: unknown } | string | null;
        if (
          value !== null &&
          typeof value === "object" &&
          value.type === "mdxJsxAttributeValueExpression"
        ) {
          found.push({
            kind: "attribute-expression",
            line: at(node),
            snippet: snippetOf(attribute.name),
          });
        }
      }
    }
  });

  return found;
}

/**
 * How much of MDX a body is allowed to be.
 *
 * `"restricted"` refuses executable constructs. `"full"` accepts them, and is
 * only correct where every author has commit access, because rendering
 * evaluates `{…}` and `import` as JavaScript on the server. The name is
 * declared here so the compiler, the SDKs and `graft.config.ts` all mean the
 * same thing by it.
 */
export type MdxTrust = "restricted" | "full";

export interface AssertSafeMdxOptions {
  /** What is being checked, for the error message (e.g. "pages/home"). */
  label?: string;
}

/**
 * Throw unless the body is free of executable constructs.
 *
 * Called on the surfaces that accept content from someone who is not the
 * operator — MCP `write_content`, Studio document saves.
 *
 * Content already in git is checked too, by `graft compile` via
 * {@link findExecutableMdx}, unless the project sets `mdxTrust = "full"`. That
 * setting is what "code review is the control" looks like when a project
 * actually claims it. Compile checks because `MdxBody` refuses executable
 * bodies at render by default, so an unchecked tree fails per-request in
 * production instead of at build time.
 */
export function assertSafeMdx(source: string, options: AssertSafeMdxOptions = {}): void {
  const found = findExecutableMdx(source);
  if (found.length === 0) return;

  const where = options.label ? ` in ${options.label}` : "";
  const listed = found
    .slice(0, 5)
    .map((node) => {
      const line = node.line === undefined ? "" : ` (line ${node.line})`;
      const snippet = node.snippet === undefined ? "" : `: ${node.snippet}`;
      return `${KIND_LABEL[node.kind]}${line}${snippet}`;
    })
    .join("; ");
  const more = found.length > 5 ? ` …and ${found.length - 5} more` : "";

  throw new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: `Executable MDX is not accepted${where} — found ${listed}${more}.`,
    fix: "Write prose, Markdown and components with literal attributes. `{…}` expressions, `import`, `export` and spread attributes are refused because rendering evaluates them as JavaScript on the server. If this content is operator-authored and needs full MDX, commit it to the repository instead, where code review is the control.",
    details: { found: found.length, nodes: found.slice(0, 20) },
  });
}
