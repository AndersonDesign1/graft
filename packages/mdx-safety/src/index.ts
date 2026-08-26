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
 * The approach here is to remove the executable surface rather than contain it.
 * `node:vm` is explicitly not a security boundary, and a worker thread cannot
 * hand React elements back across its boundary without breaking component
 * identity under RSC. What CAN be made safe is the input: prose, GFM and
 * components survive; everything that evaluates does not.
 */
import { GraftError } from "@usegraft/contracts";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/** One executable construct found in a body, with where it was. */
export interface ExecutableNode {
  /** What it is, in the reader's terms rather than the AST's. */
  kind: "expression" | "import-or-export" | "attribute-expression" | "attribute-spread";
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
};

function snippetOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

const processor = unified().use(remarkParse).use(remarkMdx);

/**
 * Every executable construct in an MDX body, in source order.
 *
 * Returns them rather than throwing so a caller can report all of them at once
 * — an author fixing one at a time learns the rule slowly and resents it.
 * Unparseable source yields nothing: a body that will not parse cannot execute
 * either, and the compile step reports the syntax error with better context.
 */
export function findExecutableMdx(source: string): ExecutableNode[] {
  let tree;
  try {
    tree = processor.parse(source);
  } catch {
    return [];
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

export interface AssertSafeMdxOptions {
  /** What is being checked, for the error message (e.g. "pages/home"). */
  label?: string;
}

/**
 * Throw unless the body is free of executable constructs.
 *
 * Called on the surfaces that accept content from someone who is not the
 * operator — MCP `write_content`, Studio document saves. Content already in git
 * is not checked here: it arrived through code review, which is the control
 * that applies to code.
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
