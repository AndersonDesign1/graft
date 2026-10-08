import { describe, expect, it } from "vitest";
import { buildVocabulary, completionTarget, expandQuery } from "./search-expand";

describe("buildVocabulary", () => {
  it("splits like the index tokenizer and ranks by frequency", () => {
    const words = buildVocabulary([
      "Configure graft.config.ts",
      "configuration: config, config",
      "a an to",
    ]);
    expect(words.slice(0, 2)).toEqual(["config", "configuration"]);
    expect(words).toContain("configure");
    expect(words).toContain("graft");
    expect(words).not.toContain("an");
  });
});

describe("expandQuery", () => {
  const vocabulary = buildVocabulary([
    "deployment deployment deploy migrations migration config configuration",
  ]);

  it("completes a partial last word with the words the docs contain", () => {
    expect(expandQuery("deploym", vocabulary)).toBe("deploym or deployment");
  });

  it("keeps the earlier words in every alternative", () => {
    expect(expandQuery("set conf", vocabulary)).toBe("set conf or set config or set configuration");
  });

  it("spends one slot per plural pair", () => {
    const words = buildVocabulary(["migration migrations migrate class classes"]);
    expect(expandQuery("migr", words)).toBe("migr or migrate or migration");
    expect(expandQuery("cla", words)).toBe("cla or class");
  });

  it("keeps words the index stems apart, like mill and million", () => {
    const words = buildVocabulary(["mill mill million"]);
    expect(expandQuery("mi", words)).toBe("mi or mill or million");
    // "state" stems apart from "stat", so typing "stat" must still offer it.
    expect(expandQuery("stat", buildVocabulary(["state states"]))).toBe("stat or state");
  });

  it("leaves a finished word that completes to nothing alone", () => {
    expect(expandQuery("deployment", vocabulary)).toBe("deployment");
    expect(expandQuery("zzz", vocabulary)).toBe("zzz");
  });

  it("leaves phrases, exclusions and or-queries as written", () => {
    expect(expandQuery('"deploy', vocabulary)).toBe('"deploy');
    expect(expandQuery('"config"', vocabulary)).toBe('"config"');
    expect(expandQuery("-conf", vocabulary)).toBe("-conf");
    expect(expandQuery("deploy or conf", vocabulary)).toBe("deploy or conf");
  });

  it("lowercases the typed word so it matches the vocabulary", () => {
    expect(expandQuery("Conf", vocabulary)).toBe("conf or config or configuration");
  });
});

describe("completionTarget", () => {
  it("names the word to complete, or null when nothing can be", () => {
    expect(completionTarget("run Migr")).toEqual({ head: ["run"], typed: "migr" });
    expect(completionTarget('"exact phrase"')).toBeNull();
    expect(completionTarget("-conf")).toBeNull();
    expect(completionTarget("a or b")).toBeNull();
    expect(completionTarget("   ")).toBeNull();
  });
});
