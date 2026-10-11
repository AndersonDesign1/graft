import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCss, checkMdx, declarations, definedVariables } from "./check-design.mjs";

const messages = (problems) => problems.map((problem) => problem.message);

test("declarations carry their selector and line, and skip comments", () => {
  const found = declarations(".a {\n  color: var(--ink);\n}\n/* .b { color: red; } */\n");
  assert.deepEqual(found, [{ selector: ".a", property: "color", value: "var(--ink)", line: 2 }]);
});

test("mono is fine on code, paths and type names", () => {
  const css = [
    "code, pre, kbd { font-family: var(--font-mono); }",
    ".prose :not(pre) > code { font-family: var(--font-mono); }",
    ".codeblock-title { font-family: var(--font-mono); }",
    ".field-type { font-family: var(--font-mono); }",
  ].join("\n");
  assert.deepEqual(checkCss(css), []);
});

test("mono on a label is a problem, even when grouped with code", () => {
  assert.deepEqual(messages(checkCss(".tab-label, code { font-family: var(--font-mono); }")), [
    'mono on ".tab-label"',
  ]);
});

test("colors come from tokens", () => {
  assert.deepEqual(checkCss(".a { color: var(--ink); background: transparent; }"), []);
  assert.deepEqual(
    checkCss(".a { background: color-mix(in oklch, var(--ink) 5%, transparent); }"),
    [],
  );
  for (const literal of ["#fff", "rgba(0, 0, 0, 0.04)", "oklch(0.2 0 0)", "white"]) {
    assert.equal(checkCss(`.a { border-color: ${literal}; }`).length, 1, literal);
  }
});

test("an id selector is not a hex color", () => {
  assert.deepEqual(checkCss("#nd-page h1 { color: var(--ink); }"), []);
});

test("three weights only", () => {
  assert.deepEqual(
    checkCss(".a { font-weight: 500; } .b { font-weight: var(--weight-semibold) !important; }"),
    [],
  );
  assert.deepEqual(messages(checkCss(".a { font-weight: 700; }")), ["font-weight 700"]);
});

test("no transition: all, no ease-in", () => {
  assert.deepEqual(
    checkCss(".a { transition: color var(--duration-fast) var(--ease-in-out); }"),
    [],
  );
  assert.deepEqual(messages(checkCss(".a { transition: all 150ms; }")), [
    "transition animates all",
  ]);
  assert.deepEqual(messages(checkCss(".a { transition: opacity 150ms ease-in; }")), [
    "ease-in in transition",
  ]);
});

test("em dashes are caught in prose, not in code", () => {
  const mdx = ["One — two.", "Run `a — b`.", "```text", "output — as printed", "```"].join("\n");
  assert.deepEqual(
    checkMdx(mdx).map((problem) => problem.line),
    [1],
  );
});

test("every CodeBlock has a title", () => {
  assert.deepEqual(checkMdx('<CodeBlock title="graft.config.ts">'), []);
  assert.deepEqual(messages(checkMdx('<CodeBlock note="x">')), ["CodeBlock without a title"]);
});

test("generated pages are skipped", () => {
  assert.deepEqual(checkMdx("---\n# GENERATED FILE. Do not edit.\ntitle: x\n---\n\nA — b."), []);
});

test("a variable nothing defines is a problem", () => {
  const css =
    ":root { --ink: currentColor; }\n.a { color: var(--ink); background: var(--paper-hover); }";
  assert.deepEqual(messages(checkCss(css, definedVariables(css))), [
    "--paper-hover is not defined",
  ]);
});

test("a fallback or a runtime variable is fine", () => {
  const css = ".a { color: var(--shiki-light); background: var(--missing, transparent); }";
  assert.deepEqual(checkCss(css, definedVariables(css)), []);
});

test("a custom property is checked for literal colors too", () => {
  assert.equal(checkCss(".a { --brand: #fff; }").length, 1);
  assert.deepEqual(checkCss(".a { --gap: var(--space-2); }"), []);
});

test("named colors are literals; names inside variables and fonts are not", () => {
  assert.equal(checkCss(".a { color: red; }").length, 1);
  assert.equal(checkCss(".a { border: 1px solid rebeccapurple; }").length, 1);
  assert.deepEqual(checkCss(".a { color: var(--red-500); background: currentColor; }"), []);
  assert.deepEqual(checkCss('.a { font-family: "Gold Sans", var(--font-sans); }'), []);
  assert.deepEqual(checkCss(".a { background: url('/assets/red-logo.svg'); }"), []);
});

test("a commented-out definition does not count", () => {
  const css = "/* :root { --brand: x; } */ .a { color: var(--brand); }";
  assert.deepEqual(messages(checkCss(css, definedVariables(css))), ["--brand is not defined"]);
});

test("a CodeBlock's title may be on a later line of its tag", () => {
  assert.deepEqual(checkMdx('<CodeBlock\n  note="x"\n  title="graft.config.ts"\n>'), []);
  assert.deepEqual(
    checkMdx('Text.\n\n<CodeBlock\n  note="x"\n>').map((problem) => problem.line),
    [3],
  );
});
