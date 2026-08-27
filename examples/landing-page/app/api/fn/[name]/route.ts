/**
 * Typed function runtime over HTTP — RPC endpoint for the functions exported
 * by graft.config.ts. Invoke: POST /api/fn/<name> with a JSON object body.
 * Success → { data }; failure → GraftError JSON with an agent-actionable fix.
 *
 * Who is calling is decided by @usegraft/auth (lib/actor.ts): Better Auth JWTs or
 * GRAFT_DEV_TOKEN; no token → anonymous, which mutations reject by default.
 *
 * P3.4: every invocation writes an audit_log row (actor + correlation + git
 * SHA), rate limits are counted against those rows, and destructive functions
 * are human-gated (`graft approve`, then retry with x-graft-approval).
 */
import { execFileSync } from "node:child_process";
import { createFunctionsHandler, type GraftFunctionsHandler } from "@usegraft/core";
import { createDb } from "@usegraft/db";
import { functions } from "@/graft.config";
import { resolveActor } from "@/lib/actor";

/** Audit rows tie invocations to the serving code; in dev that's the checkout. */
function localGitSha(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

let handler: GraftFunctionsHandler | null = null;

function getHandler(): GraftFunctionsHandler {
  handler ??= createFunctionsHandler({
    functions,
    db: () => {
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          "DATABASE_URL is not set. Put it in the repo-root .env (loaded by next.config.ts) or the environment.",
        );
      }
      return createDb(url).db;
    },
    actor: resolveActor,
    // Backstop for every function; per-function rateLimit overrides it
    // (submitContact is tighter — it is public).
    // This app runs behind Vercel's edge, which overwrites x-forwarded-for with
    // the real client address — so exactly one hop in front of us is ours to
    // trust, and the rightmost entry is the one it wrote. Without this the
    // handler has no way to tell callers apart (no adapter registers a socket
    // peer here, unlike `graft serve`) and every anonymous caller would share a
    // single bucket. Set this to the number of proxies you actually run.
    trustedProxyHops: 1,
    rateLimit: { limit: 60, windowSeconds: 60 },
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? localGitSha(),
  });
  return handler;
}

export async function POST(request: Request): Promise<Response> {
  return getHandler()(request);
}

// Functions are RPC over POST; the handler answers 405 with Allow + a fix.
export async function GET(request: Request): Promise<Response> {
  return getHandler()(request);
}
