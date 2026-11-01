import { describe, expect, it } from "vitest";
import { approvalPolicyFor, mdxTrustFor, trustedIssuersFor } from "./settings";

describe("approvalPolicyFor", () => {
  it("defaults to none, takes the three policies, and refuses anything else", () => {
    expect(approvalPolicyFor(undefined)).toBe("none");
    for (const policy of ["none", "human", "unattended"])
      expect(approvalPolicyFor(policy)).toBe(policy);
    expect(() => approvalPolicyFor("Human")).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID", details: { approvalPolicy: "Human" } }),
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

describe("trustedIssuersFor", () => {
  it("gives every issuer the audience and actor kind, as graft serve does", () => {
    expect(
      trustedIssuersFor({
        trustedIssuers: "https://a.test https://b.test",
        trustedAudience: "https://site.test,api",
        trustedActorKind: "human",
      }),
    ).toEqual([
      { issuer: "https://a.test", actorKind: "human", audience: ["https://site.test", "api"] },
      { issuer: "https://b.test", actorKind: "human", audience: ["https://site.test", "api"] },
    ]);
  });

  it("leaves the audience unchecked when it is unset, and records token holders as agents", () => {
    expect(trustedIssuersFor({ trustedIssuers: "https://a.test" })).toEqual([
      { issuer: "https://a.test", actorKind: "agent" },
    ]);
  });

  it("refuses an audience made only of separators, which would turn the check off", () => {
    expect(() =>
      trustedIssuersFor({ trustedIssuers: "https://a.test", trustedAudience: " , " }),
    ).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        fix: expect.stringMatching(/NUXT_GRAFT_TRUSTED_AUDIENCE/),
      }),
    );
  });

  it("refuses an actor kind it does not know", () => {
    expect(() =>
      trustedIssuersFor({ trustedIssuers: "https://a.test", trustedActorKind: "robot" }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});
