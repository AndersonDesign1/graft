/**
 * Parse + validate a single authored document.
 *
 * Pure (no fs, no DB): frontmatter is parsed, validated against the collection's Zod
 * schema, and normalized into a row ready for projection. Validation failures throw a
 * GraftError carrying an agent-actionable `fix`.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { GraftError } from "@graft/contracts";
import type { Collection } from "@graft/core";
import matter from "gray-matter";

export interface ProjectedDoc {
  collection: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
  contentHash: string;
  sourcePath: string;
}

export function parseDocument(
  raw: string,
  collection: Collection,
  sourcePath: string,
): ProjectedDoc {
  const { data: frontmatter, content } = matter(raw);

  const result = collection.schema.safeParse(frontmatter);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new GraftError({
      code: "SCHEMA_VALIDATION_FAILED",
      message: `${sourcePath} does not match collection "${collection.name}"`,
      fix: `Update the frontmatter to satisfy the "${collection.name}" schema — ${issues}`,
      details: { sourcePath, issues: result.error.issues },
    });
  }

  const slugValue = (frontmatter as Record<string, unknown>).slug;
  const slug =
    typeof slugValue === "string" && slugValue.length > 0
      ? slugValue
      : basename(sourcePath).replace(/\.mdx?$/, "");

  return {
    collection: collection.name,
    slug,
    data: result.data as Record<string, unknown>,
    body: content.trim(),
    contentHash: createHash("sha256").update(raw).digest("hex"),
    sourcePath,
  };
}
