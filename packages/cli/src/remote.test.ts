/**
 * Working with a hosted site: which site a command talks to, where its token
 * is kept, and `graft api`, against a stand-in site on this machine.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";
import { apiPath, buildFields, typedValue } from "./commands/api";
import { readHosts, redactToken, resolveTarget, writeHosts } from "./remote/hosts";

const TOKEN = "graft_at_test-token-value";

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

let server: Server;
let origin: string;
let seen: Seen[];
let dir: string;
let logs: string[];
let errors: string[];

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => (text += String(chunk)));
    request.on("end", () => resolve(text));
  });
}

beforeAll(async () => {
  // A stand-in for graft serve --studio: the Studio routes graft api and
  // graft login call, refusing any token but TOKEN.
  server = createServer(async (request, response) => {
    seen.push({
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization,
      body: await body(request),
    });
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return json(401, { error: "UNAUTHORIZED", message: "Who are you?", fix: "Send a token." });
    }
    const url = new URL(request.url ?? "/", "http://stub");
    if (url.pathname === "/api/studio/v1/workspace") {
      return json(200, { user: { id: "token:ci", scopes: ["studio:read"] } });
    }
    if (url.pathname === "/api/studio/v1/entries") {
      const cursor = url.searchParams.get("cursor");
      return json(200, cursor ? { items: [2] } : { items: [1], nextCursor: "page-2" });
    }
    if (url.pathname === "/api/studio/v1/entry" && request.method === "PUT")
      return json(200, { ok: true });
    return json(404, { error: "ROUTE_NOT_FOUND", message: `Nothing at ${url.pathname}.` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seen = [];
  logs = [];
  errors = [];
  dir = mkdtempSync(join(tmpdir(), "graft-remote-"));
  vi.stubEnv("XDG_CONFIG_HOME", dir);
  vi.stubEnv("GRAFT_URL", "");
  vi.stubEnv("GRAFT_TOKEN", "");
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const file = () => join(dir, "graft", "hosts.json");

function saveLogin(at: string = origin): void {
  writeHosts(
    {
      version: 1,
      default: at,
      hosts: { [at]: { token: TOKEN, savedAt: "2026-10-24T00:00:00.000Z" } },
    },
    file(),
  );
}

describe("resolveTarget", () => {
  it.each([
    [{ remote: false, local: false }, {}, "local"],
    [
      { remote: false, local: true },
      { GRAFT_URL: "https://cms.example.com", GRAFT_TOKEN: "t" },
      "local",
    ],
    [
      { remote: false, local: false },
      { GRAFT_URL: "https://cms.example.com", GRAFT_TOKEN: "t" },
      "https://cms.example.com",
    ],
    [
      { remote: true, local: false },
      { GRAFT_URL: "https://cms.example.com/studio", GRAFT_TOKEN: "t" },
      "https://cms.example.com",
    ],
  ])("%j with %j talks to %s", (choice, env, expected) => {
    const target = resolveTarget(choice, env, file());
    expect(target.kind === "local" ? "local" : target.origin).toBe(expected);
  });

  it("uses the site graft login saved for --remote", () => {
    saveLogin("https://saved.example.com");
    expect(resolveTarget({ remote: true, local: false }, {}, file())).toEqual({
      kind: "remote",
      origin: "https://saved.example.com",
      token: TOKEN,
      source: "graft login",
    });
  });

  it("refuses plain http to anything but this machine", () => {
    expect(() =>
      resolveTarget(
        { remote: true, local: false },
        { GRAFT_URL: "http://cms.example.com", GRAFT_TOKEN: "t" },
        file(),
      ),
    ).toThrow(/plain http/);
  });

  it("says how to log in when there is no site", () => {
    expect(() => resolveTarget({ remote: true, local: false }, {}, file())).toThrow(
      expect.objectContaining({
        code: "ENV_VAR_MISSING",
        fix: expect.stringContaining("graft login"),
      }),
    );
  });
});

describe("the logins file", () => {
  it("is written for its owner alone", () => {
    saveLogin();
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "graft")).mode & 0o777).toBe(0o700);
    expect(readHosts(file()).hosts[origin]?.token).toBe(TOKEN);
  });

  it("shows a token by its start only", () => {
    expect(redactToken(TOKEN)).toBe("graft_at_test…");
  });
});

describe("graft login", () => {
  it("checks the token with the site and saves it", async () => {
    // Not a terminal under the test runner, so login reads the piped token.
    const stdin = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockImplementation(async function* () {
        yield Buffer.from(`${TOKEN}\n`);
      });
    expect(await run(["login", origin, "--with-token"])).toBe(0);
    stdin.mockRestore();
    expect(logs[0]).toBe(`Logged in to ${origin} as token:ci (studio:read).`);
    expect(seen.map((request) => request.url)).toEqual(["/api/studio/v1/workspace"]);
    expect(JSON.parse(readFileSync(file(), "utf8")).default).toBe(origin);
  });
});

describe("graft api", () => {
  it("resolves paths under the Studio API and refuses everything else", () => {
    expect(apiPath("entries?collection=posts")).toBe("/api/studio/v1/entries?collection=posts");
    expect(apiPath("/api/fn/subscribe")).toBe("/api/fn/subscribe");
    for (const bad of [
      "https://evil.example/x",
      "//evil.example",
      "../secrets",
      "a/%2e%2e/b",
      "/api/mcp",
      "/api/other",
    ]) {
      expect(() => apiPath(bad)).toThrow();
    }
  });

  it("types -F values and nests bracketed keys", () => {
    expect([typedValue("true"), typedValue("null"), typedValue("12"), typedValue("12a")]).toEqual([
      true,
      null,
      12,
      "12a",
    ]);
    expect(
      buildFields([
        { key: "tags[]", value: "a" },
        { key: "tags[]", value: "b" },
        { key: "data[title]", value: "Hi" },
      ]),
    ).toEqual({ tags: ["a", "b"], data: { title: "Hi" } });
  });

  it("sends the saved token, follows nextCursor with --paginate, and prints each page", async () => {
    saveLogin();
    expect(await run(["api", "entries", "--paginate"])).toBe(0);
    expect(seen.map((request) => request.url)).toEqual([
      "/api/studio/v1/entries",
      "/api/studio/v1/entries?cursor=page-2",
    ]);
    expect(seen.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(logs).toEqual(['{"items":[1],"nextCursor":"page-2"}', '{"items":[2]}']);
  });

  it("sends fields as a JSON body", async () => {
    saveLogin();
    expect(await run(["api", "-X", "PUT", "entry", "-f", "slug=home", "-F", "draft=true"])).toBe(0);
    expect(seen[0]).toMatchObject({ method: "PUT", body: '{"slug":"home","draft":true}' });
  });

  it("exits 4 when the site refuses the token, with its error on stderr", async () => {
    saveLogin();
    vi.stubEnv("GRAFT_TOKEN", "graft_at_wrong");
    expect(await run(["api", "workspace"])).toBe(4);
    expect(errors[0]).toBe("error UNAUTHORIZED: Who are you?");
    expect(seen[0]?.authorization).toBe("Bearer graft_at_wrong");
  });

  it("will not DELETE without --yes", async () => {
    saveLogin();
    expect(await run(["api", "-X", "DELETE", "assets"])).toBe(2);
    expect(seen).toEqual([]);
  });
});
