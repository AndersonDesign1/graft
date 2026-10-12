/**
 * A free Postgres database for someone with no account anywhere: Neon's
 * claimable databases. One request makes one; it lasts 72 hours (with 100 MB)
 * until someone claims it to a free Neon account, which keeps it for good.
 *
 * The connection string it returns goes through Neon's pooler. Migrations want
 * the direct host, which is the same name without `-pooler`.
 */
import { GraftError } from "@usegraft/contracts";
import type { ClaimableDatabase } from "@usegraft/compiler";

const API = "https://neon.new/api/v1/database";

/** Who made the database, which the API asks for. */
const REFERRER = "graft";

interface ApiDatabase {
  id?: string;
  status?: string;
  connection_string?: string | null;
  claim_url?: string;
  expires_at?: string;
}

export interface NewDatabase extends ClaimableDatabase {
  /** Pooled: for the running site. */
  url: string;
  /** Direct: for migrations. */
  directUrl: string;
}

/** The direct (unpooled) form of a Neon connection string. */
export function directUrlOf(url: string): string {
  return url.replace(/-pooler\./, ".");
}

function unreachable(what: string, detail: string): GraftError {
  return new GraftError({
    code: "REMOTE_STORE_FAILED",
    message: `Couldn't ${what}: ${detail}`,
    fix: "Try again in a minute. Or use any Postgres you already have: pass --database <postgres-url>.",
  });
}

export async function createClaimableDatabase(
  fetchImpl: typeof fetch = fetch,
): Promise<NewDatabase> {
  let response: Response;
  try {
    response = await fetchImpl(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: REFERRER }),
    });
  } catch (error) {
    throw unreachable(
      "create a free database",
      error instanceof Error ? error.message : String(error),
    );
  }
  const body = (await response.json().catch(() => ({}))) as ApiDatabase;
  if (!response.ok || !body.id || !body.connection_string || !body.claim_url || !body.expires_at) {
    throw unreachable("create a free database", `the service answered ${response.status}`);
  }
  return {
    provider: "neon",
    id: body.id,
    claimUrl: body.claim_url,
    expiresAt: body.expires_at,
    url: body.connection_string,
    directUrl: directUrlOf(body.connection_string),
  };
}

export type ClaimState = "unclaimed" | "claimed" | "gone";

/** Whether a claimable database is still waiting, has been claimed, or no longer exists. */
export async function claimState(id: string, fetchImpl: typeof fetch = fetch): Promise<ClaimState> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}/${encodeURIComponent(id)}`);
  } catch (error) {
    throw unreachable(
      "check the free database",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (response.status === 404) return "gone";
  const body = (await response.json().catch(() => ({}))) as ApiDatabase;
  if (!response.ok)
    throw unreachable("check the free database", `the service answered ${response.status}`);
  return body.status === "UNCLAIMED" ? "unclaimed" : "claimed";
}
