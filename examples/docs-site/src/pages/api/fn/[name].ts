/**
 * Typed function runtime over HTTP, mounted through @graft/sdk-astro's
 * graftRoute — the handlers are Web-standard, so the adapter is one property
 * access. Invoke: POST /api/fn/<name> with a JSON object body.
 * Success → { data }; failure → GraftError JSON with an agent-actionable fix.
 */
import { execFileSync } from "node:child_process";
import { createFunctionsHandler, type GraftFunctionsHandler } from "@graft/core";
import { createDb } from "@graft/db";
import { graftRoute } from "@graft/sdk-astro";
import { functions } from "../../../../graft.config";
import { resolveActor } from "../../../lib/actor";

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
          "DATABASE_URL is not set. Put it in the repo-root .env (loaded by astro.config.mjs) or the environment.",
        );
      }
      return createDb(url).db;
    },
    actor: resolveActor,
    rateLimit: { limit: 60, windowSeconds: 60 },
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? localGitSha(),
  });
  return handler;
}

export const POST = graftRoute((request) => getHandler()(request));
// Functions are RPC over POST; the handler answers 405 with Allow + a fix.
export const GET = graftRoute((request) => getHandler()(request));
