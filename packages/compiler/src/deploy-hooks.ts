/**
 * Deploy hooks: URLs an admin adds in Studio, called after every publish. A
 * host's build hook rebuilds a static site; a site's revalidate route drops
 * what it cached. Each call's outcome is recorded on the hook, so Studio can
 * say whether the site heard about the last publish.
 *
 * A hook never fails a publish: the content is live (or committed) either
 * way, and the record says what went wrong.
 */
import { GraftError } from "@usegraft/contracts";
import type { Database, DeployHookRow } from "@usegraft/db";
import { isLoopbackHost } from "./notify";
import { readStart } from "./read-start";

export interface DeployHookEvent {
  /** `publish` after a publish; `test` when someone presses Send a test. */
  event: "publish" | "test";
  branch: string;
  /** The documents that went live, content-relative. */
  paths: string[];
}

export interface DeployHookDelivery {
  id: string;
  name: string;
  status: number | null;
  error: string | null;
}

/**
 * Why a hook URL can't be used, or null when it can: https, or http to this
 * machine. A secret may ride in the header, and a hook on the wire in the
 * clear is a free rebuild for anyone on the path.
 */
export function deployHookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That isn't a URL. Paste the hook's full address, starting with https://.";
  }
  if (url.username || url.password) {
    return "Remove the user:password@ part. Give the hook a secret instead, sent as a bearer header.";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    return "Use an https address. Plain http is allowed only to this machine (localhost).";
  }
  return null;
}

/** Call every hook with the event, in parallel, and record each outcome. Never throws. */
export async function fireDeployHooks(
  db: Database,
  event: DeployHookEvent,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<DeployHookDelivery[]> {
  let hooks: DeployHookRow[];
  try {
    hooks = await (await import("@usegraft/db")).listDeployHooks(db);
  } catch (error) {
    // A database without the table (not migrated yet) has no hooks to call.
    console.warn(`graft: deploy hooks were not read: ${errorText(error)}`);
    return [];
  }
  return Promise.all(hooks.map((hook) => deliver(db, hook, event, options)));
}

/** Call one hook, as Send a test does. */
export async function sendDeployHook(
  db: Database,
  hook: DeployHookRow,
  event: DeployHookEvent,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<DeployHookDelivery> {
  return deliver(db, hook, event, options);
}

async function deliver(
  db: Database,
  hook: DeployHookRow,
  event: DeployHookEvent,
  options: { fetch?: typeof fetch; timeoutMs?: number },
): Promise<DeployHookDelivery> {
  const result = await call(hook, event, options);
  try {
    await (await import("@usegraft/db")).recordDeployHookDelivery(db, hook.id, result);
  } catch (error) {
    console.warn(
      `graft: the "${hook.name}" deploy hook's result was not recorded: ${errorText(error)}`,
    );
  }
  return { id: hook.id, name: hook.name, ...result };
}

async function call(
  hook: DeployHookRow,
  event: DeployHookEvent,
  options: { fetch?: typeof fetch; timeoutMs?: number },
): Promise<{ status: number | null; error: string | null }> {
  const problem = deployHookUrlProblem(hook.url);
  if (problem) return { status: null, error: problem };
  const url = new URL(hook.url);
  // Errors name origin and path only: a hook URL often carries its token in
  // the query, and errors reach logs and Studio.
  const where = `${url.origin}${url.pathname}`;
  const redact = (text: string): string => {
    let out = text.split(url.href).join(where);
    if (url.search) out = out.split(url.search).join("");
    return out;
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "graft-deploy-hook",
  };
  if (hook.secret) headers.authorization = `Bearer ${hook.secret}`;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...event, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      // A redirect would resend the secret to wherever the hook points it.
      redirect: "error",
    });
    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return { status: response.status, error: null };
    }
    const detail = redact(await readStart(response, 200)).trim();
    return { status: response.status, error: detail || response.statusText || null };
  } catch (error) {
    return { status: null, error: redact(errorText(error)) };
  }
}

function errorText(error: unknown): string {
  if (error instanceof GraftError) return error.message;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "It didn't answer in time.";
  // fetch says only "fetch failed"; the reason (refused, no such host) is the cause.
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return cause ? `${error.message}: ${cause}` : error.message;
}
