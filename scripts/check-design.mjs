/**
 * The parts of DESIGN.md a machine can check, run over the docs site.
 *
 * A rule that lives only in prose gets broken by the next person or agent who
 * did not read it, so every rule here was a review comment first. Scope is the
 * docs: `global.css` and `landing.css` belong to the landing page, which keeps
 * its own look until it is rebuilt, and Studio is reviewed separately.
 *
 * CSS (docs stylesheets):
 *   - mono only on code: `code`, `pre`, `kbd`, `samp`, file paths, type names
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
const TOKENS_CSS = join(root, "packages", "tokens", "tokens.css");
const DOCS_CONTENT = join(site, "content");

/** Selectors that show code, a path or a type name, where mono is the point. */
const MONO_SELECTOR = /(^|[\s>+~(])(code|pre|kbd|samp)\b|\.codeblock-title\b|\.field-type\b/;

const LITERAL_COLOR =
  /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(^|[\s,(])(white|black)\b/i;

const ALLOWED_WEIGHT = /^(400|500|600|inherit|var\(--weight-(regular|medium|semibold)\))$/;

const EASE_IN = /(^|[^\w-])ease-in(?![\w-])/;

/** Set at runtime rather than in a stylesheet: Shiki writes these inline. */
const RUNTIME_VARIABLE = /^--shiki-/;

/** Every custom property a stylesheet defines. */
export function definedVariables(css) {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
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

    if (LITERAL_COLOR.test(value) && !property.startsWith("font")) {
      problems.push({
        line,
        message: `literal color in ${property}: ${value}`,
        fix: "Use a token from @usegraft/tokens, or color-mix() over one, so both schemes follow.",
      });
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
  let fenced = false;
  mdx.split("\n").forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) fenced = !fenced;
    if (fenced) return;
    const prose = text.replace(/`[^`]*`/g, "");
    if (prose.includes("—")) {
      problems.push({
        line: index + 1,
        message: "em dash in prose",
        fix: "Split the sentence, or use a colon, comma or parentheses.",
      });
    }
    if (/<CodeBlock\b/.test(text) && !/<CodeBlock\b[^>]*\btitle=/.test(text)) {
      problems.push({
        line: index + 1,
        message: "CodeBlock without a title",
        fix: 'Give it the file path, or title="Terminal" for a shell block.',
      });
    }
  });
  return problems;
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
  const pages = mdxFiles(DOCS_CONTENT);
  for (const file of pages) {
    for (const problem of checkMdx(readFileSync(file, "utf8"))) report.push({ file, ...problem });
  }

  if (report.length === 0) {
    console.log(
      `check:design: ${DOCS_CSS.length} stylesheet(s) and ${pages.length} page(s) clean.`,
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
