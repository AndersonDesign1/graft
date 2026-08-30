/**
 * Elicited approvals: asking the human in-band instead of out of it.
 *
 * The thing under test is not "does a dialog appear" — it is that changing how
 * the human is asked changed nothing underneath. So these drive a real MCP
 * client that declares the elicitation capability, against a fake approvals
 * store that records exactly what the real one is asked to do.
 */
import { GraftError } from "@usegraft/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createApprovalElicitor } from "./approval-elicitation";
import { invokeFunctionWithApproval } from "./tool-helpers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** The refusal a destructive call produces before anyone has approved it. */
const refusal = (approvalId: string) =>
  new GraftError({
    code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL",
    message: "destructive; an approval has been filed",
    fix: `graft approve ${approvalId}`,
    details: { function: "deleteThing", approvalId },
  });

/**
 * A handler that refuses until it is handed the approval id, which is the real
 * pipeline's contract in miniature.
 */
function handlerRequiring(approvalId: string) {
  const calls: Array<string | undefined> = [];
  const handler = async (request: Request): Promise<Response> => {
    const approval = request.headers.get("x-graft-approval") ?? undefined;
    calls.push(approval);
    if (approval !== approvalId) {
      return Response.json(refusal(approvalId).toJSON(), { status: 403 });
    }
    return Response.json({ data: { deleted: true } }, { status: 200 });
  };
  return { handler, calls };
}

/** Connect a client that answers every elicitation the same way. */
async function connect(answer: { action: "accept" | "decline" | "cancel"; approve?: boolean }) {
  const server = new McpServer({ name: "t", version: "0" });
  const client = new Client(
    { name: "test-agent", version: "0.0.0" },
    { capabilities: { elicitation: {} } },
  );
  client.setRequestHandler(ElicitRequestSchema, async () =>
    answer.action === "accept"
      ? { action: "accept", content: { approve: answer.approve ?? true } }
      : { action: answer.action },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

/** A client that never declared the capability. */
async function connectWithoutElicitation() {
  const server = new McpServer({ name: "t", version: "0" });
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

const APPROVAL_ID = "11111111-1111-1111-1111-111111111111";
const DECIDER = { kind: "human", id: "operator@example.com" };

/** Stands in for @usegraft/db's decideApproval, recording what it was asked. */
function fakeDb(behaviour: { decided?: boolean; throws?: GraftError } = {}) {
  const decisions: Array<{ id: string; decision: string; decider: unknown }> = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (behaviour.throws) throw behaviour.throws;
            decisions.push({
              id: APPROVAL_ID,
              decision: String(values.status),
              decider: values.decidedBy,
            });
            return behaviour.decided === false ? [] : [{ id: APPROVAL_ID, status: values.status }];
          },
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  };
  // SAFETY: decideApproval only ever calls update().set().where().returning()
  // and the select fallback above; anything else would throw here rather than
  // silently pass, which is the point of a fake this narrow.
  return { db: db as never, decisions };
}

describe("elicited approval", () => {
  it("asks, records the decision, and retries with the id it was granted", async () => {
    const { server, client } = await connect({ action: "accept", approve: true });
    const { db, decisions } = fakeDb();
    const { handler, calls } = handlerRequiring(APPROVAL_ID);

    const result = await invokeFunctionWithApproval(
      handler,
      "deleteThing",
      { id: 1 },
      {},
      createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
    );

    expect(result.data).toEqual({ deleted: true });
    // The retry goes back through the ordinary path carrying the approval, so
    // the one-shot consume and the audit row are the out-of-band ones.
    expect(calls).toEqual([undefined, APPROVAL_ID]);
    expect(decisions).toEqual([{ id: APPROVAL_ID, decision: "approved", decider: DECIDER.id }]);
    await client.close();
  });

  it("records a deny when the human says no, and still refuses the call", async () => {
    const { server, client } = await connect({ action: "decline" });
    const { db, decisions } = fakeDb();
    const { handler, calls } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        {},
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });

    expect(decisions).toEqual([{ id: APPROVAL_ID, decision: "denied", decider: DECIDER.id }]);
    expect(calls).toEqual([undefined]);
    await client.close();
  });

  it("treats a dismissal as no decision at all, leaving the row pending", async () => {
    const { server, client } = await connect({ action: "cancel" });
    const { db, decisions } = fakeDb();
    const { handler } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        {},
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });

    // Closing a dialog is not a "no". Recording one would put a decision in the
    // audit trail that nobody made.
    expect(decisions).toEqual([]);
    await client.close();
  });

  it("accepts the dialog but honours an explicit false", async () => {
    const { server, client } = await connect({ action: "accept", approve: false });
    const { db, decisions } = fakeDb();
    const { handler } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        {},
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });

    expect(decisions).toEqual([{ id: APPROVAL_ID, decision: "denied", decider: DECIDER.id }]);
    await client.close();
  });

  it("does not ask a client that never offered to be asked", async () => {
    const { server, client } = await connectWithoutElicitation();
    const { db, decisions } = fakeDb();
    const { handler, calls } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        {},
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });

    // A client that cannot ask its user is not a client whose user said yes.
    expect(decisions).toEqual([]);
    expect(calls).toEqual([undefined]);
    await client.close();
  });

  it("surfaces a self-decision refusal rather than swallowing it", async () => {
    // The invariant that must survive elicitation: requester-cannot-decide is
    // enforced in the UPDATE's own WHERE, so naming the requester as the
    // decider fails here exactly as it would from `graft approve`.
    const selfDecision = new GraftError({
      code: "APPROVAL_SELF_DECISION",
      message: "a requester can never decide their own approval",
      fix: "Have a DIFFERENT operator review it.",
    });
    const { server, client } = await connect({ action: "accept", approve: true });
    const { db } = fakeDb({ throws: selfDecision });
    const { handler } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        {},
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_SELF_DECISION" });
    await client.close();
  });

  it("says so when the row stopped being pending while the prompt was open", async () => {
    const { server, client } = await connect({ action: "accept", approve: true });
    const { db } = fakeDb({ decided: false });
    const { handler } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        {},
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await client.close();
  });
});

describe("without an elicitor", () => {
  it("is the out-of-band flow, unchanged", async () => {
    const { handler, calls } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(handler, "deleteThing", { id: 1 }, {}),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });
    expect(calls).toEqual([undefined]);
  });

  it("never re-asks about a call that already carried an approval", async () => {
    // A caller that sent an approval and was still refused has a different
    // problem — asking again would turn one human decision into a loop.
    const { server, client } = await connect({ action: "accept", approve: true });
    const { db, decisions } = fakeDb();
    const { handler } = handlerRequiring(APPROVAL_ID);

    await expect(
      invokeFunctionWithApproval(
        handler,
        "deleteThing",
        { id: 1 },
        { approval: "a-stale-id" },
        createApprovalElicitor({ server, db: () => db, decider: DECIDER }),
      ),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });

    expect(decisions).toEqual([]);
    await client.close();
  });
});
