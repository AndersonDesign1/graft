import { describe, expect, it } from "vitest";
import { buildVocabulary, expandQuery } from "./search-expand";

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

  it("spends one slot per stem, not one per inflection", () => {
    const words = buildVocabulary(["migrate migrated migration migrations migrator"]);
    expect(expandQuery("migr", words)).toBe("migr or migrate or migrator");
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
