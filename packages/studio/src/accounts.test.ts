import { describe, expect, it } from "vitest";
import {
  assertPassword,
  hashPassword,
  hashToken,
  isAccountToken,
  newToken,
  normaliseEmail,
  setupCode,
  setupCodeMatches,
  verifyPassword,
} from "./accounts";

describe("account secrets", () => {
  // Four scrypt runs at the real cost: about 400ms here, but over the 5s
  // default once a busy CI runner shares its CPU with the other test files.
  it("hashes a password so only the same password verifies", { timeout: 30_000 }, async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("anything", "md5$abc")).toBe(false);
    expect(await hashPassword("correct horse battery")).not.toBe(stored);
  });

  it("refuses a password that is too short or absurdly long", () => {
    expect(() => assertPassword("short")).toThrow(/at least 10/);
    expect(() => assertPassword(undefined)).toThrow(/at least 10/);
    expect(() => assertPassword("x".repeat(257))).toThrow(/at most/);
    expect(assertPassword("long enough!")).toBe("long enough!");
  });

  it("makes tokens that only their hash is stored for", () => {
    const { token, hash } = newToken();
    expect(isAccountToken(token)).toBe(true);
    expect(isAccountToken("body.mac")).toBe(false);
    expect(isAccountToken(undefined)).toBe(false);
    expect(hashToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("derives a stable setup code from the secret, forgiving case and dashes", () => {
    const code = setupCode("a".repeat(40));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(setupCode("a".repeat(40))).toBe(code);
    expect(setupCode("b".repeat(40))).not.toBe(code);
    expect(setupCodeMatches("a".repeat(40), code.toLowerCase().replace("-", " "))).toBe(true);
    expect(setupCodeMatches("a".repeat(40), "AAAAA-AAAAA")).toBe(false);
    expect(setupCodeMatches("a".repeat(40), 42)).toBe(false);
  });

  it("normalises an email, or refuses something that isn't one", () => {
    expect(normaliseEmail("  Ana@Shop.Test ")).toBe("ana@shop.test");
    expect(() => normaliseEmail("ana")).toThrow(/not an email/);
    expect(() => normaliseEmail(undefined)).toThrow(/not an email/);
  });
});
