/**
 * Typed function runtime over HTTP — RPC endpoint for the functions exported
 * by graft.config.ts. Invoke: POST /api/fn/<name> with a JSON object body.
 * Success → { data }; failure → GraftError JSON with an agent-actionable fix.
 *
 * Who is calling is decided by @graft/auth: bearer JWTs are verified against
 * the Better Auth instance this app hosts (mint one at GET /api/auth/token
 * after signing in); GRAFT_DEV_TOKEN is a static local-dev credential. No
 * token → anonymous, which mutations reject by default (public: true opts out).
 */
import { betterAuthIssuer, createActorResolver } from "@graft/auth";
import { createFunctionsHandler, type GraftFunctionsHandler } from "@graft/core";
import { createDb } from "@graft/db";
import { functions } from "@/graft.config";

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
    actor: createActorResolver({
      issuers: [betterAuthIssuer({ url: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" })],
      devTokens: process.env.GRAFT_DEV_TOKEN
        ? {
            [process.env.GRAFT_DEV_TOKEN]: {
              kind: "human",
              id: "owner",
              scopes: ["submissions:read"],
            },
          }
        : undefined,
    }),
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
