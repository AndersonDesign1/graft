/**
 * Shared internals the tool groups lean on.
 *
 * These were module-level in server.ts, reachable by every tool because they
 * lived in the same file. Splitting the tools out made that dependency explicit
 * rather than ambient — which is the point of the split.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "@usegraft/compiler";
import {
  GraftError,
  type ErrorCode,
  type FieldDescriptor,
  type GraftErrorJSON,
} from "@usegraft/contracts";
import { APPROVAL_HEADER, type AnyCollection, type GraftFunctionsHandler } from "@usegraft/core";

/**
 * Invoke a function through a createFunctionsHandler instance via a synthetic
 * Request — the shared bridge behind run_function and delete_content, so MCP
 * calls take the exact pipeline `POST /api/fn/<name>` takes (validation,
 * access, rate limits, audit, human gate). Failures become GraftErrors.
 */
export async function invokeFunction(
  handler: GraftFunctionsHandler,
  name: string,
  input: Record<string, unknown>,
  identity: { credential?: string; approval?: string },
): Promise<{ data: unknown; correlationId?: string; status: number }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (identity.credential) {
    const token = identity.credential.trim();
    headers.set(
      "authorization",
      token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
    );
  }
  if (identity.approval) headers.set(APPROVAL_HEADER, identity.approval);

  const response = await handler(
    new Request(`http://graft.local/fn/${encodeURIComponent(name)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    }),
  );
  const body: unknown = await response.json();
  const correlationId = response.headers.get("x-graft-correlation-id") ?? undefined;

  if (!response.ok) {
    throw graftErrorFromBody(body, correlationId);
  }
  const data =
    body !== null && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : body;
  return { data, correlationId, status: response.status };
}

/**
 * MCP-surface teaching for asset fields. Core's describe() is surface-neutral
 * (a CLI user uploads with `graft asset put`), so describe_schema appends the
 * value shape and the put_asset pointer here — the P6.5 live cold agent had to
 * infer both from existing documents. Recursive: asset fields nest inside
 * object/array fields.
 */
const ASSET_FIELD_HINT =
  "Asset reference: the value is an object { key, alt? }. Upload the file with the put_asset tool first — its response includes the exact snippet to use here.";

export function teachAssetFields(fieldDescriptor: FieldDescriptor): FieldDescriptor {
  const taught: FieldDescriptor = {
    ...fieldDescriptor,
    ...(fieldDescriptor.type === "asset"
      ? {
          description: fieldDescriptor.description
            ? `${fieldDescriptor.description} ${ASSET_FIELD_HINT}`
            : ASSET_FIELD_HINT,
        }
      : {}),
  };
  if (fieldDescriptor.fields) taught.fields = fieldDescriptor.fields.map(teachAssetFields);
  if (fieldDescriptor.items) taught.items = teachAssetFields(fieldDescriptor.items);
  return taught;
}

/**
 * The functions handler speaks HTTP — its approval fixes say "retry with the
 * header `x-graft-approval: <id>`". Over MCP there are no headers; the retry
 * carries the `approval` tool argument instead. Translate at the boundary so
 * the error self-teaches on the surface it is actually served on.
 */
export function toMcpFix(fix: string | undefined): string | undefined {
  if (!fix) return fix;
  return fix
    .replace(/the header `x-graft-approval: ([^`]+)`/g, 'the `approval` argument set to "$1"')
    .replace(/WITHOUT the x-graft-approval header/g, "WITHOUT the `approval` argument");
}

/** Rebuild a GraftError from a functions-handler / HTTP error body. */
export function graftErrorFromBody(body: unknown, correlationId?: string): GraftError {
  if (body !== null && typeof body === "object") {
    const json = body as GraftErrorJSON;
    if (typeof json.error === "string" && typeof json.message === "string") {
      return new GraftError({
        code: json.error as ErrorCode,
        message: json.message,
        fix: toMcpFix(json.fix),
        details: {
          ...json.details,
          ...(correlationId ? { correlationId } : {}),
        },
      });
    }
  }
  return new GraftError({
    code: "FUNCTION_EXECUTION_FAILED",
    message: "Function invocation failed with a non-GraftError response.",
    fix: "Inspect the server logs; retry with list_functions / describe_function to confirm the name and input shape.",
    details: { body, correlationId },
  });
}

/**
 * Reject a write whose slug is already claimed by a different file. Files that
 * currently fail to parse are skipped — they can't reliably claim a slug, and
 * compile() will surface them with their own fix.
 */
export function assertSlugFree(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
  targetSourcePath: string,
): void {
  const dir = join(contentDir, collectionName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;

  for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const normalized = name.split("\\").join("/");
    const sourcePath = `${collectionName}/${normalized}`;
    const full = join(dir, name);
    if (sourcePath === targetSourcePath || !/\.mdx?$/.test(name) || statSync(full).isDirectory()) {
      continue;
    }
    let existingSlug: string;
    try {
      existingSlug = parseDocument(readFileSync(full, "utf8"), collection, sourcePath).slug;
    } catch {
      continue;
    }
    if (existingSlug === slug) {
      throw new GraftError({
        code: "SLUG_NOT_UNIQUE",
        message: `Slug "${slug}" in collection "${collectionName}" is already used by ${sourcePath}`,
        fix: `Update that document instead (write_content with slug "${slug}" targets ${targetSourcePath}, but ${sourcePath} owns the slug via frontmatter), or pick a different slug.`,
        details: { slug, collection: collectionName, existing: sourcePath },
      });
    }
  }
}
