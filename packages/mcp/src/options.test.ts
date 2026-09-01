/**
 * The MCP surface deliberately offers a narrower approval policy than the
 * function runtime underneath it.
 *
 * `createFunctionsHandler` accepts `"unattended"`, which lifts the gate on
 * destructive work for a caller with no human behind it — a scheduled job, a CI
 * migration. An MCP mount is the opposite case: it exists because an agent is
 * calling it, and the agent is the party the gate is there to stop. One option
 * that turned every destructive tool an agent can reach into an ungated one is
 * not a trade worth offering, so it is not on this surface.
 *
 * Pinned as a type test rather than left to review because the two option types
 * are structurally compatible in the direction that matters: widening this
 * union back to the core one would still assign cleanly at the forwarding site
 * in `server.ts` and break nothing a runtime test would notice.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { GraftMcpOptions } from "./options";

type McpPolicy = NonNullable<GraftMcpOptions["approvalPolicy"]>;

describe("approvalPolicy on the MCP surface", () => {
  it("offers exactly none and human", () => {
    expectTypeOf<McpPolicy>().toEqualTypeOf<"none" | "human">();
  });

  it('does not accept "unattended"', () => {
    // @ts-expect-error — the whole point of the narrowing. If this line stops
    // erroring, the MCP surface has regained the ungated policy.
    const policy: McpPolicy = "unattended";
    void policy;
  });
});
