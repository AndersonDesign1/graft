/**
 * The parts of DESIGN.md a machine can check, run over the docs site and
 * Studio.
 *
 * A rule that lives only in prose gets broken by the next person or agent who
 * did not read it, so every rule here was a review comment first. Scope is the
 * docs and Studio: `global.css` and `landing.css` belong to the landing page,
 * which keeps its own look until it is rebuilt.
 *
 * CSS (docs and Studio stylesheets):
 *   - mono only on code: `code`, `pre`, `kbd`, `samp`, file paths, type names,
 *     and Studio's identifiers (slugs, paths, field names, branches, diffs)
 *   - no literal colors: every color comes from `@usegraft/tokens`
 *   - font weights 400, 500 and 600 only
 *   - no `transition: all`, no `ease-in` (things that respond to a person
 *     start fast and settle)
 *   - no `var(--name)` that nothing defines: the declaration is silently
 *     dropped, so the bug only shows as a missing color
 *
 * Content (docs MDX, generated pages skipped):
 *   - no em dashes in prose
 *   - every `<CodeBlock>` has a `title`
 *
 * Run: node scripts/check-design.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const site = join(root, "examples", "docs-site");

const DOCS_CSS = [join(site, "src", "styles", "fumadocs.css")];
const STUDIO_STYLES = join(root, "packages", "studio", "src", "ui", "styles");
/** Studio's sheets, checked together: a role defined in one is read in another. */
const STUDIO_CSS = [
  "type.css",
  "roles.css",
  "studio.css",
  "shell.css",
  "parts.css",
  "editor.css",
].map((name) => join(STUDIO_STYLES, name));
const TOKENS_CSS = join(root, "packages", "tokens", "tokens.css");
const DOCS_CONTENT = join(site, "content");

/**
 * Selectors that show code, a path or a type name, where mono is the point.
 * Studio's identifier classes end in what they hold (`-slug`, `-path`,
 * `-json`), or are named here one by one.
 */
const MONO_SELECTOR =
  /(^|[\s>+~(])(code|pre|kbd|samp)\b|\.codeblock-title\b|\.field-type\b|-(slug|path|sha|json|source|attrs|tag|code)\b|\.(type|field-name|set-value|set-collection-where|diff-line|top-branch|top-repo)\b/;

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** The CSS named colors. `transparent` and `currentColor` are not literals. */
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

/** Properties whose values are names, not colors (`font-family: Courier`). */
const NOT_A_COLOR =
  /^(font|animation-name|grid|content|counter|quotes|list-style-type|will-change)/;

/** Whether a declaration's value spells a color instead of reading a token. */
function hasLiteralColor(property, value) {
  if (NOT_A_COLOR.test(property)) return false;
  // Variable names (`--red-500`) are references and a url() is a path, not
  // color words.
  const bare = value.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)|--[\w-]+/gi, "");
  if (LITERAL_COLOR.test(bare)) return true;
  return bare
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => NAMED_COLORS.has(word));
}

const ALLOWED_WEIGHT = /^(400|500|600|inherit|var\(--weight-(regular|medium|semibold)\))$/;

const EASE_IN = /(^|[^\w-])ease-in(?![\w-])/;

/**
 * Set at runtime rather than in a stylesheet: Shiki writes its colors inline,
 * Base UI hands popups their origin and room, and Studio's tabs set where the
 * active tab sits.
 */
const RUNTIME_VARIABLE = /^--(shiki-|transform-origin$|available-|anchor-|active-tab-)/;

/** Every custom property a stylesheet defines, ignoring commented-out ones. */
export function definedVariables(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
}

/**
 * Every declaration in a stylesheet with the selector it sits under and its
 * line. Comments are blanked first so a commented-out rule is not checked.
 */
export function declarations(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const found = [];
  const selectors = [];
  let buffer = "";
  let line = 1;
  let start = 1;
  for (const char of text) {
    if (char === "\n") line++;
    if (char === "{") {
      selectors.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
      continue;
    }
    if (char === "}" || char === ";") {
      const declaration = buffer.trim();
      const colon = declaration.indexOf(":");
      if (colon > 0 && selectors.length > 0) {
        found.push({
          selector: selectors.at(-1),
          property: declaration.slice(0, colon).trim().toLowerCase(),
          value: declaration
            .slice(colon + 1)
            .replace(/!important/i, "")
            .trim(),
          line: start,
        });
      }
      if (char === "}") selectors.pop();
      buffer = "";
      continue;
    }
    if (buffer.trim() === "" && char.trim() !== "") start = line;
    buffer += char;
  }
  return found;
}

/**
 * Design problems in one stylesheet, each with the fix. `defined` is every
 * custom property in scope (the tokens plus this stylesheet); without it,
 * undefined variables are not checked.
 */
export function checkCss(css, defined) {
  const problems = [];
  for (const { selector, property, value, line } of declarations(css)) {
    if (defined) {
      for (const [, name] of value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        if (defined.has(name) || RUNTIME_VARIABLE.test(name)) continue;
        problems.push({
          line,
          message: `${name} is not defined`,
          fix: "Use a token that exists in @usegraft/tokens, or define it in this stylesheet.",
        });
      }
    }
    if (hasLiteralColor(property, value)) {
      problems.push({
        line,
        message: `literal color in ${property}: ${value}`,
        fix: "Use a token from @usegraft/tokens, or color-mix() over one, so both schemes follow.",
      });
    }

    if (property.startsWith("--")) continue;

    if (property === "font-family" && value.includes("--font-mono")) {
      const offCode = selector.split(",").filter((part) => !MONO_SELECTOR.test(part.trim()));
      if (offCode.length > 0) {
        problems.push({
          line,
          message: `mono on "${offCode.join(", ").trim()}"`,
          fix: "Labels, captions and badges use var(--font-sans). Mono is for code, paths and type names.",
        });
      }
    }

    if (property === "font-weight" && !ALLOWED_WEIGHT.test(value)) {
      problems.push({
        line,
        message: `font-weight ${value}`,
        fix: "Use var(--weight-regular), var(--weight-medium) or var(--weight-semibold).",
      });
    }

    if (property === "transition" || property === "transition-property") {
      if (/(^|[\s,])all\b/.test(value)) {
        problems.push({
          line,
          message: `${property} animates all`,
          fix: "Name the properties that change, such as background-color and color.",
        });
      }
    }

    if (/^(transition|animation)/.test(property) && EASE_IN.test(value)) {
      problems.push({
        line,
        message: `ease-in in ${property}`,
        fix: "Use var(--ease-out) for anything that responds to a person.",
      });
    }
  }
  return problems;
}

/** Design problems in one MDX page, each with the fix. Generated pages pass. */
export function checkMdx(mdx) {
  if (/^---[\s\S]*?GENERATED FILE[\s\S]*?^---/m.test(mdx)) return [];
  const problems = [];
  const lines = mdx.split("\n");
  const fencedLines = new Set();
  let fenced = false;
  lines.forEach((text, index) => {
    const fence = /^\s*(```|~~~)/.test(text);
    if (fence) fenced = !fenced;
    if (fenced || fence) {
      fencedLines.add(index + 1);
      return;
    }
    const prose = text.replace(/`[^`]*`/g, "");
    if (prose.includes("—")) {
      problems.push({
        line: index + 1,
        message: "em dash in prose",
        fix: "Split the sentence, or use a colon, comma or parentheses.",
      });
    }
  });
  // The whole opening tag, which may span lines: `title` can be on any of them.
  for (const match of mdx.matchAll(/<CodeBlock\b[^>]*>/g)) {
    const line = mdx.slice(0, match.index).split("\n").length;
    if (fencedLines.has(line) || /\btitle=/.test(match[0])) continue;
    problems.push({
      line,
      message: "CodeBlock without a title",
      fix: 'Give it the file path, or title="Terminal" for a shell block.',
    });
  }
  return problems.sort((a, b) => a.line - b.line);
}

function mdxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

function main() {
  const report = [];
  const tokens = readFileSync(TOKENS_CSS, "utf8");
  for (const file of DOCS_CSS) {
    const css = readFileSync(file, "utf8");
    const defined = definedVariables(tokens + css);
    for (const problem of checkCss(css, defined)) report.push({ file, ...problem });
  }
  const studio = STUDIO_CSS.map((file) => ({ file, css: readFileSync(file, "utf8") }));
  const studioDefined = definedVariables(tokens + studio.map(({ css }) => css).join("\n"));
  for (const { file, css } of studio) {
    for (const problem of checkCss(css, studioDefined)) report.push({ file, ...problem });
  }
  const pages = mdxFiles(DOCS_CONTENT);
  for (const file of pages) {
    for (const problem of checkMdx(readFileSync(file, "utf8"))) report.push({ file, ...problem });
  }

  if (report.length === 0) {
    console.log(
      `check:design: ${DOCS_CSS.length + STUDIO_CSS.length} stylesheet(s) and ${pages.length} page(s) clean.`,
    );
    return;
  }
  for (const { file, line, message, fix } of report) {
    console.error(`${relative(root, file)}:${line}  ${message}\n  fix: ${fix}`);
  }
  console.error(`\ncheck:design: ${report.length} problem(s). The rules are in DESIGN.md.`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
