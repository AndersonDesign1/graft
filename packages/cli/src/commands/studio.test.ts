import { ROLE_SCOPES } from "@usegraft/studio";
import { describe, expect, it } from "vitest";
import { operatorAuthenticate } from "./studio";

const request = (authorization?: string) =>
  new Request("http://studio.test/", {
    headers: authorization ? { authorization } : {},
  });

describe("operatorAuthenticate", () => {
  it("lets nobody sign in on loopback, so the operator may do anything", () => {
    expect(operatorAuthenticate(true, "secret", ROLE_SCOPES.admin)).toBeUndefined();
  });

  it("refuses everyone beyond loopback when there is no dev token", () => {
    const authenticate = operatorAuthenticate(false, undefined, ROLE_SCOPES.admin);
    expect(authenticate?.(request("Bearer anything"))).toBeNull();
  });

  it("gives the dev token every scope an admin has, publishing included", () => {
    const authenticate = operatorAuthenticate(false, "secret", ROLE_SCOPES.admin);
    expect(authenticate?.(request("Bearer wrong"))).toBeNull();
    expect(authenticate?.(request())).toBeNull();
    const principal = authenticate?.(request("Bearer secret"));
    expect(principal).toMatchObject({ kind: "human", scopes: [...ROLE_SCOPES.admin] });
    expect(ROLE_SCOPES.admin).toContain("studio:publish");
  });
});
