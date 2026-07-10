/**
 * serveStdio lifetime — regression for the latent P6.2 bug where it resolved
 * at connect time, letting `graft mcp` fall through to process.exit right
 * after the initialize handshake.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { describe, expect, it } from "vitest";
import { serveStdio } from "./index";

describe("serveStdio", () => {
  it("resolves on transport close, not at connect", async () => {
    let transport: StdioServerTransport | undefined;
    let protocolOncloseRan = false;
    // A server whose connect captures the transport and installs its own
    // onclose (as the real Protocol does) without ever starting stdin.
    const server = {
      connect: async (t: StdioServerTransport) => {
        transport = t;
        t.onclose = () => {
          protocolOncloseRan = true;
        };
      },
    } as unknown as McpServer;

    let resolved = false;
    const serving = serveStdio(server).then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 25));
    expect(resolved).toBe(false); // still serving — the CLI must not exit here

    transport?.onclose?.(); // client disconnects
    await serving;
    expect(resolved).toBe(true);
    expect(protocolOncloseRan).toBe(true); // the protocol's own cleanup still ran
  });
});
