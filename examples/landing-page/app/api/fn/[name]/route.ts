/**
 * Typed function runtime over HTTP — RPC endpoint for the functions exported
 * by graft.config.ts. Invoke: POST /api/fn/<name> with a JSON object body.
 * Success → { data }; failure → GraftError JSON with an agent-actionable fix.
 */
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
    // Bearer stopgap until @graft/auth (scoped OIDC-verified tokens, P3.3):
    // a matching GRAFT_FUNCTIONS_TOKEN makes the caller a non-anonymous actor,
    // which is what gated functions (listSubmissions) check.
    actor: (request) => {
      const token = process.env.GRAFT_FUNCTIONS_TOKEN;
      const header = request.headers.get("authorization");
      return token && header === `Bearer ${token}`
        ? { kind: "human", id: "owner" }
        : { kind: "anonymous" };
    },
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
