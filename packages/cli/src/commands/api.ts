/**
 * graft api — call any Studio API route on a hosted site with the saved
 * token, and print the answer. What curl does, without copying the token
 * into a command line or writing JSON by hand.
 *
 *   graft api entries -f collection=posts
 *   graft api -X PUT site -F 'name=Acme'
 *
 * A path is under /api/studio/v1 unless it names /api/studio/v1, /api/fn or
 * /api/content/v1 itself. Nothing else is reachable: not another origin, not
 * a path that climbs out with `..`, and not /api/mcp, which `graft mcp call`
 * speaks properly.
 */
import { readFileSync } from "node:fs";
import { ErrorCodes, GraftError, type ErrorCode } from "@usegraft/contracts";
import { UsageError } from "../args";
import { formatJson } from "../output";
import { siteFetch } from "../remote/site-http";

const STUDIO = "/api/studio/v1";
const ALLOWED = [`${STUDIO}/`, "/api/fn/", "/api/content/v1/"];

/** The site path for what the person typed, or a UsageError saying why not. */
export function apiPath(typed: string): string {
  const refuse = (why: string): never => {
    throw new UsageError(
      `graft api cannot call "${typed}": ${why}`,
      "Run `graft api` to list the Studio routes.",
      {
        command: "api",
        path: typed,
      },
    );
  };
  // URL parsing drops tabs and line breaks, so a path holding them would be
  // checked as one thing and sent as another.
  if ([...typed].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    refuse("paths may not contain control characters, such as tabs or line breaks.");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(typed) || typed.startsWith("//")) {
    refuse("it names another site. Paths go to the site you logged in to.");
  }
  const [pathname = ""] = typed.split("?");
  if (/(^|\/)\.\.?(\/|$)/.test(pathname) || /%2e|%2f|%5c|\\/i.test(pathname)) {
    refuse("paths may not contain . or .. segments, or encoded slashes and dots.");
  }
  if (pathname === "/api/mcp" || pathname.startsWith("/api/mcp/")) {
    refuse("/api/mcp speaks MCP. Use graft mcp call <tool> --remote.");
  }
  if (typed.startsWith("/api/")) {
    if (!ALLOWED.some((prefix) => typed.startsWith(prefix))) {
      refuse(`only ${ALLOWED.map((p) => `${p}*`).join(", ")} can be called.`);
    }
    return typed;
  }
  return `${STUDIO}/${typed.replace(/^\/+/, "")}`;
}

type Json = string | number | boolean | null | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };
/** One `-f` or `-F` field, once its value is read. */
type Field = { key: string; value: Json };
/** One `-f` or `-F` field as typed. */
type RawField = { key: string; value: string };

/** `-F` values: true, false, null and numbers as JSON, @file and @- as text, the rest as strings. */
export function typedValue(raw: string): Json {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "@-") return readFileSync(0, "utf8");
  if (raw.startsWith("@")) return readFileSync(raw.slice(1), "utf8");
  return raw;
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** `key=value`, `key[]=value` and `key[sub]=value` into one object. */
export function buildFields(entries: readonly { key: string; value: Json }[]): {
  [key: string]: Json;
} {
  const root: { [key: string]: Json } = {};
  for (const { key, value } of entries) {
    const parts = key.split("[").map((part, i) => (i === 0 ? part : part.replace(/\]$/, "")));
    // These names reach the object's prototype instead of making a field.
    const unsafe = parts.find((part) => UNSAFE_KEYS.has(part));
    if (unsafe !== undefined) {
      throw new UsageError(
        `the field name ${key} uses "${unsafe}", which cannot be a field.`,
        "Rename the field. Send the body with --input <file> if the route needs that exact name.",
        { command: "api", field: key },
      );
    }
    let node: JsonObject = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? "";
      const last = i === parts.length - 1;
      const next = parts[i + 1];
      if (last) {
        node[part] = value;
      } else if (next === "") {
        const existing = Object.hasOwn(node, part) ? node[part] : undefined;
        const list = Array.isArray(existing) ? existing : [];
        list.push(value);
        node[part] = list;
        break;
      } else {
        const child = Object.hasOwn(node, part) ? node[part] : undefined;
        const object =
          typeof child === "object" && child !== null && !Array.isArray(child) ? child : {};
        node[part] = object;
        node = object;
      }
    }
  }
  return root;
}

function splitField(raw: string, flag: string): RawField {
  const at = raw.indexOf("=");
  if (at <= 0) {
    throw new UsageError(`${flag} ${raw} is not key=value.`, `Write it as ${flag} name=value.`, {
      command: "api",
      flag,
    });
  }
  return { key: raw.slice(0, at), value: raw.slice(at + 1) };
}

export interface ApiOptions {
  origin: string;
  token: string;
  path: string;
  method: string | undefined;
  rawFields: readonly string[];
  typedFields: readonly string[];
  headers: readonly string[];
  input: string | undefined;
  include: boolean;
  paginate: boolean;
  /** A DELETE goes ahead only with this. */
  yes: boolean;
}

export interface ApiOutcome {
  /** Each page's body, parsed when it is JSON. */
  pages: Json[];
  status: number;
}

function parseBody(text: string): Json {
  try {
    // SAFETY: JSON.parse only ever produces JSON values.
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

/** Call the route, page by page with --paginate, printing each answer as it arrives. */
export async function apiCommand(options: ApiOptions): Promise<ApiOutcome> {
  const fields = buildFields([
    ...options.rawFields.map((raw) => {
      const { key, value } = splitField(raw, "-f");
      const field: Field = { key, value };
      return field;
    }),
    ...options.typedFields.map((raw) => {
      const { key, value } = splitField(raw, "-F");
      return { key, value: typedValue(value) };
    }),
  ]);
  const hasFields = Object.keys(fields).length > 0;
  // Fields or a body mean POST, unless --paginate says this is a listing.
  const fallback = !options.paginate && (hasFields || options.input !== undefined) ? "POST" : "GET";
  const method = (options.method ?? fallback).toUpperCase();
  if (method === "DELETE" && !options.yes) {
    throw new UsageError(
      `graft api -X DELETE changes ${options.origin} and needs --yes.`,
      "Run it again with --yes once you are sure.",
      { command: "api", method },
    );
  }
  if (options.paginate && method !== "GET") {
    throw new UsageError("--paginate works with GET only.", "Drop -X, or drop --paginate.", {
      command: "api",
    });
  }

  const headers: Record<string, string> = {};
  for (const raw of options.headers) {
    const at = raw.indexOf(":");
    const name = raw.slice(0, at).trim();
    if (at <= 0 || !name) {
      throw new UsageError(`-H ${raw} is not "Name: value".`, 'Write it as -H "Name: value".', {
        command: "api",
      });
    }
    if (name.toLowerCase() === "authorization") {
      throw new UsageError(
        "graft api sends the saved token itself; -H Authorization is refused.",
        "Use graft login, or GRAFT_TOKEN, for the token.",
        { command: "api" },
      );
    }
    headers[name] = raw.slice(at + 1).trim();
  }

  const base = new URL(apiPath(options.path), options.origin);
  let body: string | undefined;
  if (options.input !== undefined) {
    body = options.input === "-" ? readFileSync(0, "utf8") : readFileSync(options.input, "utf8");
    for (const [key, value] of Object.entries(fields)) base.searchParams.append(key, String(value));
  } else if (hasFields && method === "GET") {
    for (const [key, value] of Object.entries(fields)) {
      base.searchParams.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  } else if (hasFields) {
    body = JSON.stringify(fields);
  }
  // Check the path the request will really go to, as well as the one typed.
  if (
    base.origin !== new URL(options.origin).origin ||
    !ALLOWED.some((prefix) => base.pathname.startsWith(prefix))
  ) {
    throw new UsageError(
      `graft api cannot call "${options.path}".`,
      "Paths go to the site you logged in to.",
      {
        command: "api",
      },
    );
  }

  const pages: Json[] = [];
  const cursors = new Set<string>();
  let url = base;
  for (;;) {
    const request: Parameters<typeof siteFetch>[0] = {
      origin: options.origin,
      token: options.token,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    };
    if (body !== undefined) request.body = body;
    const response = await siteFetch(request);
    const parsed = parseBody(await response.text());
    if (options.include) {
      console.log(`HTTP ${response.status} ${response.statusText}`);
      for (const [name, value] of response.headers) console.log(`${name}: ${value}`);
      console.log("");
    }
    console.log(typeof parsed === "string" ? parsed : formatJson(parsed));
    pages.push(parsed);
    if (!response.ok) {
      throw failure(response.status, parsed, options.origin);
    }
    const next =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed.nextCursor
        : null;
    if (!options.paginate || typeof next !== "string" || !next) break;
    // Every page is followed until the last one. A cursor seen before would
    // loop forever, so it stops the command instead of ending it quietly.
    if (cursors.has(next)) {
      throw new GraftError({
        code: "REMOTE_UNREACHABLE",
        message: `${options.origin} sent the cursor "${next}" twice, so --paginate stopped after ${pages.length} pages.`,
        fix: "The pages so far are printed above. Report this to whoever runs the site, or page by hand with -f cursor=<value>.",
        details: { origin: options.origin, cursor: next, pages: pages.length },
      });
    }
    cursors.add(next);
    url = new URL(url);
    url.searchParams.set("cursor", next);
  }
  return { pages, status: 200 };
}

/** A failed answer as the GraftError it carries, so it prints with its fix and exit code. */
function failure(status: number, body: Json, origin: string): GraftError {
  const object = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
  const message =
    typeof object.message === "string" ? object.message : `${origin} answered HTTP ${status}.`;
  const fix = typeof object.fix === "string" ? object.fix : undefined;
  const sent =
    typeof object.error === "string" && Object.hasOwn(ErrorCodes, object.error)
      ? object.error
      : undefined;
  if (sent !== undefined) {
    // SAFETY: Object.hasOwn(ErrorCodes, …) just checked it is a known code.
    const options: ConstructorParameters<typeof GraftError>[0] = {
      code: sent as ErrorCode,
      message,
    };
    if (fix) options.fix = fix;
    options.details = { origin, status };
    return new GraftError(options);
  }
  if (status === 401 || status === 403) {
    return new GraftError({
      code: "TOKEN_INVALID",
      message,
      fix: "Make a token with the access this needs in Studio under Developer, Agents, and run graft login again.",
      details: { origin, status },
    });
  }
  return new GraftError({
    code: "REMOTE_UNREACHABLE",
    message,
    fix: "The answer is printed above. Check the path with `graft api`, which lists the routes.",
    details: { origin, status },
  });
}

/** `graft api` alone: the routes the site's OpenAPI document lists. */
export async function apiRoutes(
  origin: string,
  token: string,
): Promise<{ method: string; path: string; summary: string }[]> {
  const response = await siteFetch({ origin, token, path: `${STUDIO}/openapi.json` });
  const body = parseBody(await response.text());
  if (!response.ok) throw failure(response.status, body, origin);
  const paths =
    typeof body === "object" && body !== null && !Array.isArray(body) ? body.paths : null;
  const routes: { method: string; path: string; summary: string }[] = [];
  if (typeof paths !== "object" || paths === null || Array.isArray(paths)) return routes;
  for (const [path, operations] of Object.entries(paths)) {
    if (typeof operations !== "object" || operations === null || Array.isArray(operations))
      continue;
    for (const [method, operation] of Object.entries(operations)) {
      const summary =
        typeof operation === "object" &&
        operation !== null &&
        !Array.isArray(operation) &&
        typeof operation.summary === "string"
          ? operation.summary
          : "";
      routes.push({ method: method.toUpperCase(), path, summary });
    }
  }
  return routes;
}
