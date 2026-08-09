/**
 * The content migration runner: read every file in the collection, transform,
 * validate the output against the CURRENT schema, and only then write — a run
 * either rewrites cleanly or touches nothing (all failures are collected and
 * reported together, per file). Dry-run is the default posture upstream; this
 * runner only writes when `apply` is set.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";
import matter from "gray-matter";
import type { AnyContentMigration } from "./define";

export interface RunContentMigrationOptions {
  /** Absolute path to the content root (files live at <contentDir>/<collection>/…). */
  contentDir: string;
  migration: AnyContentMigration;
  /** Write the transformed files. Defaults to false — report only. */
  apply?: boolean;
}

export interface ContentMigrationFileResult {
  sourcePath: string;
  slug: string;
  changed: boolean;
}

export interface ContentMigrationReport {
  collection: string;
  files: ContentMigrationFileResult[];
  changed: number;
  unchanged: number;
  /** True when the changed files were written (apply mode). */
  applied: boolean;
}

interface FileFailure {
  sourcePath: string;
  reason: string;
}

export async function runContentMigration(
  options: RunContentMigrationOptions,
): Promise<ContentMigrationReport> {
  const { contentDir, migration } = options;
  const collection = migration.collection;

  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    throw new GraftError({
      code: "CONTENT_DIR_NOT_FOUND",
      message: `Content directory not found: ${contentDir}`,
      fix: `Run from the project root (contentDir comes from graft.config.ts), or create the directory.`,
      details: { contentDir },
    });
  }

  const dir = join(contentDir, collection.name);
  const files =
    existsSync(dir) && statSync(dir).isDirectory()
      ? walk(dir).map((file) => ({
          file,
          sourcePath: `${collection.name}/${file
            .slice(dir.length + 1)
            .split(sep)
            .join("/")}`,
        }))
      : [];

  const results: ContentMigrationFileResult[] = [];
  const writes: { file: string; raw: string }[] = [];
  const failures: FileFailure[] = [];

  for (const { file, sourcePath } of files) {
    const raw = readFileSync(file, "utf8");
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(raw);
    } catch (error) {
      failures.push({
        sourcePath,
        reason: `frontmatter is not parseable YAML (${error instanceof Error ? error.message : String(error)}) — fix the file before migrating`,
      });
      continue;
    }

    const frontmatter = parsed.data as Record<string, unknown>;
    // Same slug rule as the compiler: explicit frontmatter slug, else filename.
    const explicitSlug =
      typeof frontmatter.slug === "string" && frontmatter.slug.length > 0
        ? frontmatter.slug
        : undefined;
    const slug = explicitSlug ?? basename(sourcePath).replace(/\.mdx?$/, "");
    const { slug: _slug, ...data } = frontmatter;

    let next: { data: Record<string, unknown>; body?: string };
    try {
      next = await migration.transform({ slug, sourcePath, data, body: parsed.content });
    } catch (error) {
      failures.push({
        sourcePath,
        reason: `transform threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const validated = collection.schema.safeParse(next.data);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      failures.push({ sourcePath, reason: `transformed data fails the schema — ${issues}` });
      continue;
    }

    const nextBody = next.body ?? parsed.content;
    const changed =
      JSON.stringify(next.data) !== JSON.stringify(data) || nextBody !== parsed.content;
    results.push({ sourcePath, slug, changed });
    if (changed) {
      // Preserve an explicit slug; write the transform's output as authored
      // (validation is a gate, not a normalizer — files carry raw frontmatter).
      const nextFrontmatter = {
        ...(explicitSlug !== undefined && { slug: explicitSlug }),
        ...next.data,
      };
      writes.push({ file, raw: matter.stringify(nextBody, nextFrontmatter) });
    }
  }

  if (failures.length > 0) {
    throw new GraftError({
      code: "MIGRATION_FAILED",
      message: `Content migration for "${collection.name}" failed on ${failures.length} of ${files.length} file(s); nothing was written.`,
      fix: `Fix the transform (or the listed files) so every output satisfies the current "${collection.name}" schema, then re-run. Failures: ${failures.map((f) => `${f.sourcePath}: ${f.reason}`).join(" | ")}`,
      details: { collection: collection.name, failures },
    });
  }

  if (options.apply) {
    for (const write of writes) writeFileSync(write.file, write.raw);
  }

  const changed = results.filter((r) => r.changed).length;
  return {
    collection: collection.name,
    files: results,
    changed,
    unchanged: results.length - changed,
    applied: options.apply === true,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.mdx?$/.test(name)) out.push(full);
  }
  return out.sort();
}
