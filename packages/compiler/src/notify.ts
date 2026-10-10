/**
 * Tell the app that content changed, so it can refresh its cache.
 *
 * Every write path ends in a compile, and a compile returns a ChangeSet. Before
 * this, the ChangeSet went back to the caller and stopped there: an agent's
 * `write_content` or a Studio save updated the index, and the app kept serving
 * its cached copy until someone called its revalidate route by hand.
 *
 * Two pieces:
 * - `ContentChangeListener` is the hook. A handler mounted inside the app (an
 *   adapter's MCP route) passes one that refreshes in-process.
 * - `createRevalidateWebhook` is a listener that POSTs the change to the app's
 *   revalidate route. `graft serve`, `graft studio` and `graft mcp` build one
 *   from GRAFT_REVALIDATE_URL and GRAFT_WEBHOOK_SECRET.
 */
import { GraftError, type ChangeSet, type GraftErrorJSON } from "@usegraft/contracts";

/** What changed, on which branch. The body a revalidate route reads. */
export interface ContentChangeEvent {
  branch: string;
  /** Null when the content tree is not in a git checkout. */
  gitSha: string | null;
  changes: ChangeSet;
}

/** Called after a write changed the index. Throw to report a failed refresh. */
export type ContentChangeListener = (event: ContentChangeEvent) => void | Promise<void>;

/** Whether the app has anything to refresh. An unchanged compile does not. */
export function hasContentChanges(changes: ChangeSet): boolean {
  return changes.added.length + changes.changed.length + changes.removed.length > 0;
}

/**
 * The outcome of telling the app. `ok: false` means the content was written but
 * the app may still serve the old copy.
 */
export type ContentChangeNotice =
  | { ok: true }
  | { ok: false; error: GraftErrorJSON["error"]; message: string; fix?: string };

/**
 * How to recover from a failed refresh. Recompiling does not help: the index
 * already holds the change, so a later compile reports these documents as
 * unchanged and its ChangeSet names none of them. The only record of what to
 * refresh is this event, so it is logged in full for the operator to resend.
 */
const RESEND =
  "Then resend this change: POST the { branch, gitSha, changes } body logged with this error to the revalidate route (an agent's result carries the same changes). A later compile reports these documents as unchanged, so it will not refresh them.";

/**
 * Run the listener for a change, if there is one and something changed.
 *
 * Never throws. The write already landed, so failing it now would tell the
 * caller to retry something that succeeded. The failure is returned for the
 * caller to surface and logged to stderr so an operator sees it either way.
 */
export async function notifyContentChange(
  listener: ContentChangeListener | undefined,
  event: ContentChangeEvent,
): Promise<ContentChangeNotice | undefined> {
  if (!listener || !hasContentChanges(event.changes)) return undefined;
  try {
    await listener(event);
    return { ok: true };
  } catch (error) {
    const graftError =
      error instanceof GraftError
        ? error
        : new GraftError({
            code: "REVALIDATE_FAILED",
            message: `The content was written, but refreshing the app failed: ${error instanceof Error ? error.message : String(error)}`,
            fix: `Fix the onContentChange listener. ${RESEND}`,
          });
    // The code leads the line so `REVALIDATE_FAILED` is searchable in logs.
    console.error(
      `graft: ${graftError.code}: ${graftError.message}\n  fix: ${graftError.fix ?? ""}\n  resend: ${JSON.stringify(event)}`,
    );
    return {
      ok: false,
      error: graftError.code,
      message: graftError.message,
      fix: graftError.fix,
    };
  }
}

export interface RevalidateWebhookOptions {
  /** The app's revalidate route, e.g. https://example.com/api/revalidate. */
  url: string;
  /** Sent as `Authorization: Bearer <secret>`. The route compares it. */
  secret: string;
  /** Give up after this long. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A listener that POSTs `{ branch, gitSha, changes }` to the app's revalidate
 * route, the same body `graft compile --json` prints.
 *
 * Refuses plain http to anything but loopback: the secret rides in a header,
 * and a revalidate secret on the wire is a free cache-purge for anyone on the
 * path.
 */
export function createRevalidateWebhook(options: RevalidateWebhookOptions): ContentChangeListener {
  const url = parseWebhookUrl(options.url);
  if (!options.secret) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "A revalidate webhook needs a secret, and none was given.",
      fix: "Set GRAFT_WEBHOOK_SECRET to the same value the app's revalidate route checks.",
      details: { variable: "GRAFT_WEBHOOK_SECRET" },
    });
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const send = options.fetch ?? fetch;
  // What errors name. A URL can carry a token in its query or userinfo, and
  // errors reach logs, agents and Studio toasts, so they get origin + path only.
  const where = `${url.origin}${url.pathname}`;

  return async (event) => {
    let response: Response;
    try {
      response = await send(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          branch: event.branch,
          gitSha: event.gitSha,
          changes: event.changes,
        }),
        signal: AbortSignal.timeout(timeoutMs),
        // A redirect would resend the secret to wherever the app points it.
        redirect: "error",
      });
    } catch (error) {
      // fetch errors can quote the whole URL, query token included.
      const reason = (error instanceof Error ? error.message : String(error))
        .split(url.href)
        .join(where);
      throw new GraftError({
        code: "REVALIDATE_FAILED",
        message: `The content was written, but the revalidate request to ${url.origin} failed: ${reason}`,
        fix: `Check that GRAFT_REVALIDATE_URL (${where}) is reachable from this server and does not redirect. ${RESEND}`,
        details: { url: where },
      });
    }
    if (!response.ok) {
      const detail = await readStart(response, 300);
      throw new GraftError({
        code: "REVALIDATE_FAILED",
        message: `The content was written, but the app's revalidate route answered ${response.status}.${detail ? ` ${detail}` : ""}`,
        fix:
          response.status === 401 || response.status === 403
            ? `GRAFT_WEBHOOK_SECRET here must equal the secret the revalidate route checks. Set the same value on both. ${RESEND}`
            : `Check the revalidate route at ${where}. It must accept POST { branch, gitSha, changes } with the bearer secret. ${RESEND}`,
        details: { url: where, status: response.status },
      });
    }
  };
}

/**
 * The first `limit` characters of an error body, read without buffering the
 * rest: a misconfigured route can answer with an arbitrarily large page, and
 * only the start of it goes into the message. Never throws.
 */
async function readStart(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A body that fails mid-read still leaves whatever arrived.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, limit);
}

function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "GRAFT_REVALIDATE_URL is not a URL.",
      fix: "Set it to the app's revalidate route, e.g. https://example.com/api/revalidate.",
      details: { variable: "GRAFT_REVALIDATE_URL" },
    });
  }
  // fetch refuses a URL with credentials in it, and quotes the URL when it
  // does. Refuse it here, without echoing what was in it.
  if (url.username || url.password) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `GRAFT_REVALIDATE_URL carries a username or password: ${url.origin}${url.pathname}.`,
      fix: "Remove the user:password@ part. The webhook authenticates with GRAFT_WEBHOOK_SECRET, sent as a bearer header.",
      details: { variable: "GRAFT_REVALIDATE_URL" },
    });
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `GRAFT_REVALIDATE_URL must use https (plain http is allowed only for loopback: localhost, 127.0.0.1, [::1]): ${url.origin}${url.pathname}.`,
      fix: "Use the https address of the app's revalidate route. The webhook secret travels in a header, so it must not cross the network in the clear.",
      details: { variable: "GRAFT_REVALIDATE_URL", protocol: url.protocol },
    });
  }
  return url;
}

/**
 * Build the webhook from GRAFT_REVALIDATE_URL and GRAFT_WEBHOOK_SECRET, or
 * return undefined when the URL is unset. A URL without a secret, or a bad URL,
 * throws, so a server refuses to start rather than silently never refreshing.
 */
export function revalidateWebhookFromEnv(
  env: Record<string, string | undefined> = process.env,
): ContentChangeListener | undefined {
  const url = env.GRAFT_REVALIDATE_URL?.trim();
  if (!url) return undefined;
  const secret = env.GRAFT_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "GRAFT_REVALIDATE_URL is set but GRAFT_WEBHOOK_SECRET is not.",
      fix: "Set GRAFT_WEBHOOK_SECRET to the secret the app's revalidate route checks, or unset GRAFT_REVALIDATE_URL to turn the webhook off.",
      details: { variable: "GRAFT_WEBHOOK_SECRET" },
    });
  }
  return createRevalidateWebhook({ url, secret });
}
