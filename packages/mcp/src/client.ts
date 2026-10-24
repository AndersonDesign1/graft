/**
 * Calling the project's tools from code, the way an agent calls them.
 *
 * The graft CLI's content commands are these tools run by name, so a command
 * and the tool an agent uses cannot drift apart: same validation, same scopes,
 * same answer. `connectInProcess` runs the server in the same process;
 * `connectRemote` reaches a hosted deployment's /api/mcp with a bearer token;
 * `connectClient` takes any other transport.
 *
 * A failed call comes back as the GraftError the tool threw (code, message,
 * fix, details), rebuilt from the JSON `fail()` sends.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCodes, GraftError, type ErrorCode } from "@usegraft/contracts";
import { VERSION } from "./version";

/** What a tool answers with: the JSON its result carries. */
export type ToolValue =
  | string
  | number
  | boolean
  | null
  | ToolValue[]
  | { [key: string]: ToolValue };

/** An object answer, which is what nearly every tool returns. */
export type ToolObject = { [key: string]: ToolValue };

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
}

export interface ToolClient {
  /** Call a tool. Resolves to its answer; rejects with the GraftError it failed with. */
  call(name: string, input?: Record<string, unknown>): Promise<ToolValue>;
  /** Every tool the server offers. */
  tools(): Promise<ToolInfo[]>;
  close(): Promise<void>;
}

interface CallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export const isToolObject = (value: ToolValue | undefined): value is ToolObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function textOf(result: CallResult): string {
  return (result.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function parseJson(text: string): ToolValue | undefined {
  try {
    // SAFETY: JSON.parse only ever produces JSON values.
    return JSON.parse(text) as ToolValue;
  } catch {
    return undefined;
  }
}

/**
 * The GraftError a failed tool call carries. `fail()` sends GraftErrorJSON;
 * anything else (the SDK's own input validation, a non-Graft error) becomes
 * INPUT_VALIDATION_FAILED with the text as its message.
 */
export function toolResultToGraftError(name: string, result: CallResult): GraftError {
  const text = textOf(result);
  const json = parseJson(text);
  if (
    isToolObject(json) &&
    typeof json.error === "string" &&
    Object.hasOwn(ErrorCodes, json.error)
  ) {
    // SAFETY: Object.hasOwn(ErrorCodes, …) just checked it is a known code.
    const code = json.error as ErrorCode;
    const options: ConstructorParameters<typeof GraftError>[0] = {
      code,
      message: typeof json.message === "string" ? json.message : `${name} failed.`,
    };
    if (typeof json.fix === "string") options.fix = json.fix;
    if (isToolObject(json.details)) options.details = json.details;
    return new GraftError(options);
  }
  return new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: text || `${name} failed.`,
    fix: `Check the input against the tool's schema: graft mcp tools lists them, and describe_schema shows the content fields.`,
    details: { tool: name },
  });
}

/** A client on any transport. The caller owns the transport's other end. */
export async function connectClient(
  transport: Transport,
  onClose: () => Promise<void> = async () => {},
): Promise<ToolClient> {
  const client = new Client({ name: "graft-cli", version: VERSION });
  await client.connect(transport);
  let listed: ToolInfo[] | undefined;

  const tools = async (): Promise<ToolInfo[]> => {
    if (!listed) {
      const { tools: all } = await client.listTools();
      listed = all.map((tool) => {
        const info: ToolInfo = { name: tool.name };
        if (tool.title) info.title = tool.title;
        if (tool.description) info.description = tool.description;
        return info;
      });
    }
    return listed;
  };

  const call = async (name: string, input: Record<string, unknown> = {}): Promise<ToolValue> => {
    if (!(await tools()).some((tool) => tool.name === name)) {
      throw new GraftError({
        code: "ROUTE_NOT_FOUND",
        message: `This project's MCP server has no ${name} tool.`,
        fix: "Run `graft mcp tools` to see the tools it offers. Some exist only for some projects: drafts, for example, only where content is kept in the database or saved to GitHub.",
        details: { tool: name },
      });
    }
    // SAFETY: callTool's result is the protocol's CallToolResult; CallResult
    // names the three fields read here, each checked before use.
    const result = (await client.callTool({ name, arguments: input })) as CallResult;
    if (result.isError) throw toolResultToGraftError(name, result);
    if (result.structuredContent) {
      // SAFETY: structuredContent is the JSON object the tool returned.
      return result.structuredContent as ToolObject;
    }
    const text = textOf(result);
    return parseJson(text) ?? text;
  };

  return {
    call,
    tools,
    async close() {
      await client.close();
      await onClose();
    },
  };
}

/** A client for a server running in this process. */
export async function connectInProcess(server: McpServer): Promise<ToolClient> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  return connectClient(clientSide, () => server.close());
}

export interface RemoteOptions {
  /** The site's origin, such as https://cms.example.com. */
  origin: string;
  /** A bearer token the site accepts, such as one made in Studio under Developer, Agents. */
  token: string;
}

/**
 * What a failed HTTP exchange means for the person at the terminal: a token
 * the site refused (TOKEN_INVALID), or a site that could not be reached or is
 * not Graft (REMOTE_UNREACHABLE). A GraftError from a tool passes through.
 */
export function remoteError(error: unknown, origin: string): GraftError {
  if (error instanceof GraftError) return error;
  const status = error instanceof StreamableHTTPError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) {
    return new GraftError({
      code: "TOKEN_INVALID",
      message: `${origin} refused the token (HTTP ${status}).`,
      fix: `Run \`graft login ${origin}\` with a token made in Studio under Developer, Agents, or set GRAFT_TOKEN. A revoked token stops working at once.`,
      details: { origin, status },
    });
  }
  return new GraftError({
    code: "REMOTE_UNREACHABLE",
    message: `Could not use the MCP endpoint at ${origin}/api/mcp: ${message}`,
    fix: "Check the address with `graft auth status`, and that the site runs graft serve. Log in again with `graft login <url>` if it moved.",
    details: status === undefined ? { origin } : { origin, status },
  });
}

/**
 * A client for a hosted deployment's /api/mcp. Redirects are not followed, so
 * the token is only ever sent to the origin it was given for.
 */
export async function connectRemote(options: RemoteOptions): Promise<ToolClient> {
  const transport = new StreamableHTTPClientTransport(new URL("/api/mcp", options.origin), {
    requestInit: {
      headers: { authorization: `Bearer ${options.token}` },
      redirect: "manual",
    },
  });
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw remoteError(error, options.origin);
    }
  };
  const client = await guard(() => connectClient(transport));
  return {
    call: (name, input) => guard(() => client.call(name, input)),
    tools: () => guard(() => client.tools()),
    close: () => client.close(),
  };
}
