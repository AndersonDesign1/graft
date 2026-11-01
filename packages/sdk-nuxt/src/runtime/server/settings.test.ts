import { describe, expect, it } from "vitest";
import { approvalPolicyFor, mdxTrustFor, runtimeSettings, trustedIssuersFor } from "./settings";

describe("approvalPolicyFor", () => {
  it("defaults to none, takes the three policies, and refuses anything else", () => {
    expect(approvalPolicyFor(undefined)).toBe("none");
    for (const policy of ["none", "human", "unattended"])
      expect(approvalPolicyFor(policy)).toBe(policy);
    expect(() => approvalPolicyFor("Human")).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        details: { approvalPolicy: "Human" },
      }),
    );
  });
});

describe("mdxTrustFor", () => {
  it("defaults to restricted, takes full, and refuses anything else", () => {
    expect(mdxTrustFor(undefined)).toBe("restricted");
    expect(mdxTrustFor("full")).toBe("full");
    expect(() => mdxTrustFor("open")).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });
});

describe("runtimeSettings", () => {
  it("turns the numbers and booleans Nuxt makes of NUXT_GRAFT_* values back into their text", () => {
    // NUXT_GRAFT_TRUSTED_AUDIENCE=123456 reaches the server as the number 123456.
    const settings = runtimeSettings({
      trustedAudience: 123456,
      devToken: true,
    });
    expect(settings.trustedAudience).toBe("123456");
    expect(settings.devToken).toBe("true");
    expect(settings.databaseUrl).toBe("");
  });

  it("refuses a value that is not text, naming its variable", () => {
    expect(() => runtimeSettings({ trustedIssuers: { a: 1 } })).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        details: { variable: "NUXT_GRAFT_TRUSTED_ISSUERS", value: { a: 1 } },
      }),
    );
  });
});

describe("trustedIssuersFor", () => {
  it("gives every issuer the audience and actor kind, as graft serve does", () => {
    expect(
      trustedIssuersFor(
        runtimeSettings({
          trustedIssuers: "https://a.test https://b.test",
          trustedAudience: "https://site.test,api",
          trustedActorKind: "human",
        }),
      ),
    ).toEqual([
      {
        issuer: "https://a.test",
        actorKind: "human",
        audience: ["https://site.test", "api"],
      },
      {
        issuer: "https://b.test",
        actorKind: "human",
        audience: ["https://site.test", "api"],
      },
    ]);
  });

  it("leaves the audience unchecked when it is unset, and records token holders as agents", () => {
    expect(trustedIssuersFor(runtimeSettings({ trustedIssuers: "https://a.test" }))).toEqual([
      { issuer: "https://a.test", actorKind: "agent" },
    ]);
  });

  it("refuses an audience made only of separators, which would turn the check off", () => {
    expect(() =>
      trustedIssuersFor(
        runtimeSettings({
          trustedIssuers: "https://a.test",
          trustedAudience: " , ",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        fix: expect.stringMatching(/NUXT_GRAFT_TRUSTED_AUDIENCE/),
      }),
    );
  });

  it("refuses an actor kind it does not know", () => {
    expect(() =>
      trustedIssuersFor(
        runtimeSettings({
          trustedIssuers: "https://a.test",
          trustedActorKind: "robot",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});
