/**
 * Content-revalidation webhook — the write side of the Phase 4 cache-tag
 * contract. After `graft compile` runs (CLI, CI, or an agent), POST the branch
 * and the compile's ChangeSet here and the app refreshes exactly the pages that
 * changed:
 *
 *   POST /api/revalidate
 *   Authorization: Bearer <GRAFT_DEV_TOKEN or a JWT>
 *   { "branch": "main", "changes": { "added": [...], "changed": [...], "removed": [...], "unchanged": 0 } }
 *
 * revalidateContent turns the ChangeSet into per-doc + per-collection
 * revalidateTag calls (background revalidation). It is a no-op until the app
 * caches reads with `'use cache'` + `cacheTag(...tagsFor(...))` — see llms.txt.
 * Gated by the same actor resolver as the function runtime: anonymous → 401.
 */
import { GraftError } from "@usegraft/contracts";
import type { ChangeSet } from "@usegraft/sdk-next";
import { revalidateContent } from "@usegraft/sdk-next";
import { resolveActor } from "@/lib/actor";

function isChangeSet(value: unknown): value is ChangeSet {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const isStrings = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((s) => typeof s === "string");
  return isStrings(c.added) && isStrings(c.changed) && isStrings(c.removed);
}

export async function POST(request: Request): Promise<Response> {
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  try {
    const actor = await resolveActor(request);
    if (actor.kind === "anonymous") {
      return json(
        new GraftError({
          code: "UNAUTHORIZED",
          message: "Revalidation requires an authenticated caller.",
          fix: "Send Authorization: Bearer <GRAFT_DEV_TOKEN or a JWT>. This webhook is machine-to-machine (run after `graft compile`).",
        }).toJSON(),
        401,
      );
    }

    const body = (await request.json().catch(() => null)) as {
      branch?: unknown;
      changes?: unknown;
    } | null;
    const branch = typeof body?.branch === "string" ? body.branch : "main";
    if (!body || !isChangeSet(body.changes)) {
      return json(
        new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "Body must be { branch?: string, changes: ChangeSet }.",
          fix: 'POST the JSON that `graft compile` prints as its ChangeSet, e.g. { "branch": "main", "changes": { "added": ["pages/home"], "changed": [], "removed": [], "unchanged": 2 } }.',
        }).toJSON(),
        400,
      );
    }

    const revalidated = revalidateContent(branch, body.changes);
    return json({ branch, revalidated }, 200);
  } catch (error) {
    if (error instanceof GraftError) {
      return json(error.toJSON(), error.code === "TOKEN_INVALID" ? 401 : 400);
    }
    throw error;
  }
}

export function GET(): Response {
  return new Response(
    JSON.stringify(
      new GraftError({
        code: "METHOD_NOT_ALLOWED",
        message: "Revalidation is POST-only.",
        fix: "POST { branch, changes } with an Authorization bearer token.",
      }).toJSON(),
    ),
    { status: 405, headers: { "content-type": "application/json", allow: "POST" } },
  );
}
