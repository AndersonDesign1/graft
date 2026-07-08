import { describe, expect, it } from "vitest";
import { satisfies } from "./version";

describe("satisfies", () => {
  it("treats *, empty, and x as any version", () => {
    expect(satisfies("0.0.0", "*")).toBe(true);
    expect(satisfies("9.9.9", "")).toBe(true);
    expect(satisfies("1.2.3", "x")).toBe(true);
  });

  it("checks a single comparator", () => {
    expect(satisfies("1.2.3", ">=1.0.0")).toBe(true);
    expect(satisfies("0.9.0", ">=1.0.0")).toBe(false);
    expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
    expect(satisfies("2.0.0", ">1.9.9")).toBe(true);
  });

  it("ANDs the comparators in a range", () => {
    expect(satisfies("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfies("0.9.9", ">=1.0.0 <2.0.0")).toBe(false);
  });

  it("fails closed on an unparseable version", () => {
    expect(satisfies("not-a-version", ">=1.0.0")).toBe(false);
  });
});
