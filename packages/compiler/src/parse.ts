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
import type { AnyCollection } from "@graft/core";
import matter from "gray-matter";

/** Kebab-case: URL-safe, unambiguous in paths, and stable as a primary-key part. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  collection: AnyCollection,
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

  if (!SLUG_RE.test(slug)) {
    throw new GraftError({
      code: "INVALID_SLUG",
      message: `Slug "${slug}" (${sourcePath}) is not URL-safe`,
      fix: `Slugs must be kebab-case: lowercase letters, digits, and single hyphens (e.g. "getting-started"). Set a valid \`slug\` in frontmatter or rename the file.`,
      details: { slug, sourcePath, pattern: SLUG_RE.source },
    });
  }

  return {
    collection: collection.name,
    slug,
    data: result.data as Record<string, unknown>,
    body: content.trim(),
    contentHash: createHash("sha256").update(raw).digest("hex"),
    sourcePath,
  };
}
