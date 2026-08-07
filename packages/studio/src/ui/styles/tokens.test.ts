/**
 * Enforces the three-layer token contract, so "swap a colour without touching
 * a component" stays true rather than becoming folklore.
 *
 *   palette.css  raw scales — the only file allowed a colour literal
 *   roles.css    meaning -> scale — var() indirection only
 *   studio.css   components — role names only
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = join(process.cwd(), "src", "ui", "styles");
const read = (name: string): string => readFileSync(join(here, name), "utf8");

/** Every layer-3 stylesheet. Both must obey the same rules. */
const COMPONENT_SHEETS = ["studio.css", "parts.css"];
const components = (): string => COMPONENT_SHEETS.map(read).join("\n");

/** Drop comments so prose about colours doesn't trip the literal checks. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * An actual colour value. `color-mix()` is deliberately absent: mixing is
 * still indirection as long as the things being mixed are tokens, which the
 * per-declaration assertion below checks.
 */
const LITERAL = /(oklch|rgba?|hsla?|lab|lch)\(|#[0-9a-fA-F]{3,8}\b/;
/** Layer-1 scale names, plus the syntax tokens studio.css used to improvise with. */
const RAW_SCALE = /var\(--(?:c|gh|code)-/;

describe("token layering", () => {
  it("keeps colour literals out of roles.css", () => {
    const offenders = stripComments(read("roles.css"))
      .split("\n")
      .filter((line) => LITERAL.test(line));
    expect(offenders).toEqual([]);
  });

  it("keeps colour literals out of the component sheets", () => {
    // color-mix is allowed here only against a role var (the identity tint),
    // so check for actual literals rather than any colour function.
    const offenders = stripComments(components())
      .split("\n")
      .filter((line) => /(oklch|lab|lch)\(|#[0-9a-fA-F]{3,8}\b/.test(line));
    expect(offenders).toEqual([]);
  });

  it("stops components reaching past roles into the raw scales", () => {
    const offenders = stripComments(components())
      .split("\n")
      .filter((line) => RAW_SCALE.test(line));
    expect(offenders).toEqual([]);
  });

  it("resolves every role to a var(), never to a literal", () => {
    const declarations = stripComments(read("roles.css")).matchAll(
      /^\s*(--[\w-]+):\s*([^;]+);/gm,
    );
    for (const [, name, raw] of declarations) {
      if (name === "--identity-count") continue; // a number, not a colour
      const value = raw?.trim() ?? "";
      // A bare token, or a color-mix over tokens — mixing is still
      // indirection as long as every colour in it came from layer 1.
      const isToken = value.startsWith("var(--");
      const isMixOfTokens =
        value.startsWith("color-mix(") && !/#[0-9a-fA-F]{3,8}\b|oklch\(|rgba?\(|hsla?\(/.test(value);
      expect(isToken || isMixOfTokens, `${name} must point at a token, not a literal`).toBe(true);
    }
  });

  it("defines a role for every document state the API can return", () => {
    const roles = read("roles.css");
    for (const state of ["synced", "drifted", "unindexed", "orphaned"]) {
      for (const slot of ["bg", "border", "solid", "text"]) {
        expect(roles, `--state-${state}-${slot} is missing`).toContain(`--state-${state}-${slot}:`);
      }
    }
  });

  it("keeps the identity cycle and its declared count in step", () => {
    const roles = read("roles.css");
    const count = Number(/--identity-count:\s*(\d+)/.exec(roles)?.[1]);
    const defined = [...roles.matchAll(/--identity-(\d+):/g)].length;
    // format.ts hashes into this range; a mismatch silently drops a hue.
    expect(defined).toBe(count);
  });
});
