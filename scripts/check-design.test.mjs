import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCss, checkMdx, declarations } from "./check-design.mjs";

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

test("custom properties are the tokens' business, not this check's", () => {
  assert.deepEqual(checkCss(":root { --x: #fff; }"), []);
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
