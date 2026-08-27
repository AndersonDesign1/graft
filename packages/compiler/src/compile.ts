/**
 * Compile authored content into the content_index.
 *
 * `readDocs` walks the content directory, maps each top-level folder to a registered
 * collection, validates every file, and enforces slug uniqueness — surfacing problems
 * as agent-actionable GraftErrors. `compile` then projects the result into Postgres via
 * @usegraft/db's atomic hash-diff projection and reports exactly what changed, recording
 * the git SHA it compiled from (the "git is authoritative" audit trail).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { findExecutableMdx, UncheckableMdxError, type MdxTrust } from "@usegraft/mdx-safety";
import { walkContentFiles } from "./content-files";
import type { AnyCollection } from "@usegraft/core";
import {
  projectBranchContent,
  projectStaticContent,
  type ChangeSet,
  type Database,
} from "@usegraft/db";
import { parseDocument, type ProjectedDoc } from "./parse";

export interface CompileOptions {
  contentDir: string;
  collections: Record<string, AnyCollection>;
  db: Database;
  branchId?: string;
  /**
   * Git commit recorded with this compilation. Omit to auto-resolve from
   * `contentDir` (tolerant: records null outside a git repo); pass null to skip.
   */
  gitSha?: string | null;
  /**
   * Also remove index rows in collections this schema doesn't know. Off by
   * default: purging unknown collections is the signature of two projects
   * sharing one DATABASE_URL, so projection aborts with INDEX_OWNERSHIP
   * unless this is set (legitimate after a collection rename/delete).
   */
  pruneUnknown?: boolean;
  /**
   * How much of MDX authored bodies may be. Defaults to "restricted", matching
   * MdxBody, so a document that compiles is a document that renders. From
   * `export const mdxTrust` in graft.config.ts.
   */
  mdxTrust?: MdxTrust;
}

export interface CompileResult {
  count: number;
  docs: ProjectedDoc[];
  /** What this run did to the index: added / changed / removed keys + unchanged count. */
  changes: ChangeSet;
  /** The commit the content tree was compiled from, when resolvable. */
  gitSha: string | null;
}

export interface ReadDocsOptions {
  /**
   * How much of MDX authored bodies may be. Defaults to "restricted", which is
   * also MdxBody's default, so a document that compiles is a document that
   * renders. Set "full" only where every author has commit access.
   */
  mdxTrust?: MdxTrust;
}

/** Read + validate the content tree into normalized docs. Pure of the database. */
export function readDocs(
  contentDir: string,
  collections: Record<string, AnyCollection>,
  options: ReadDocsOptions = {},
): ProjectedDoc[] {
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    throw new GraftError({
      code: "CONTENT_DIR_NOT_FOUND",
      message: `Content directory not found: ${contentDir}`,
      fix: `Create it (documents live at <contentDir>/<collection>/<slug>.mdx, e.g. content/pages/home.mdx) or pass the correct \`contentDir\` to compile().`,
      details: { contentDir, collections: Object.keys(collections) },
    });
  }

  const docs: ProjectedDoc[] = [];
  const seen = new Map<string, string>();
  // Collected rather than thrown per file: an author fixing one document at a
  // time learns the rule slowly and resents it. Same reasoning assertSafeMdx
  // applies within one body, applied across the tree.
  const executable: { sourcePath: string; found: number; first: string }[] = [];
  const unreadable: { sourcePath: string; reason: string }[] = [];
  const mdxTrust: MdxTrust = options.mdxTrust ?? "restricted";

  for (const file of walkContentFiles(contentDir)) {
    const sourcePath = relative(contentDir, file).split(sep).join("/");
    const segments = sourcePath.split("/");
    const collectionName = segments.length > 1 ? (segments[0] ?? "") : "";
    const collection = collections[collectionName];
    if (!collection) {
      const known = Object.keys(collections).join(", ") || "(none registered)";
      throw new GraftError({
        code: "COLLECTION_NOT_FOUND",
        message:
          segments.length > 1
            ? `No collection registered for "${collectionName}" (${sourcePath})`
            : `${sourcePath} sits at the content root; documents must live in a collection folder`,
        fix:
          segments.length > 1
            ? `Register it — defineCollection({ name: "${collectionName}", fields: { … } }) and pass it to compile() — or move the file into one of: ${known}.`
            : `Move it to <contentDir>/<collection>/${sourcePath}. Registered collections: ${known}.`,
        details: { sourcePath, collection: collectionName, registered: Object.keys(collections) },
      });
    }

    if (collection.authority === "db-authoritative") {
      throw new GraftError({
        code: "AUTHORITY_MISMATCH",
        message: `${sourcePath} is a file, but collection "${collectionName}" is db-authoritative — its records live in Postgres, not in the content tree.`,
        fix: `Remove the file and write the data through the collection's functions instead (insertRecord via a defineFunction mutation). Files are only for file-authoritative collections.`,
        details: { sourcePath, collection: collectionName, authority: collection.authority },
      });
    }

    const doc = parseDocument(readFileSync(file, "utf8"), collection, sourcePath);

    // MdxBody refuses executable bodies at render, and content can reach the
    // index without passing a write handler, so that check stays where it is.
    // This one exists so the refusal happens at build time on the authored
    // path, instead of per-request in production on the page itself.
    if (mdxTrust !== "full") {
      try {
        const found = findExecutableMdx(doc.body);
        if (found.length > 0) {
          const first = found[0];
          executable.push({
            sourcePath,
            found: found.length,
            first: first?.line === undefined ? "" : `line ${first.line}`,
          });
        }
      } catch (error) {
        // Source the checker cannot parse is refused, not waved through: the
        // renderer's parser is not this one, and the gap between them is
        // exactly where executable source would sit.
        if (!(error instanceof UncheckableMdxError)) throw error;
        unreadable.push({ sourcePath, reason: error.message });
      }
    }

    const key = `${doc.collection}/${doc.slug}`;
    const existing = seen.get(key);
    if (existing) {
      throw new GraftError({
        code: "SLUG_NOT_UNIQUE",
        message: `Slug "${doc.slug}" in collection "${doc.collection}" is used by both ${existing} and ${sourcePath}`,
        fix: `Give one a unique \`slug\` in frontmatter, or rename the file.`,
        details: { slug: doc.slug, collection: doc.collection, files: [existing, sourcePath] },
      });
    }
    seen.set(key, sourcePath);
    docs.push(doc);
  }

  if (unreadable.length > 0) {
    const listed = unreadable.map((u) => `${u.sourcePath} (${u.reason})`).join(", ");
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `${unreadable.length} document(s) could not be checked for executable MDX: ${listed}.`,
      fix: "Fix the MDX syntax so it parses. Unparseable source is refused rather than indexed, because the renderer's parser is not this one and the difference between them is where executable source would hide.",
      details: { unreadable },
    });
  }

  if (executable.length > 0) {
    const listed = executable
      .slice(0, 10)
      .map((e) => (e.first === "" ? e.sourcePath : `${e.sourcePath} (${e.first})`))
      .join(", ");
    const more = executable.length > 10 ? ` …and ${executable.length - 10} more` : "";
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `Executable MDX in ${executable.length} document(s): ${listed}${more}.`,
      fix: 'Rendering evaluates `{…}` and `import` as JavaScript on the server, and MdxBody refuses them by default, so these documents would fail per-request rather than here. Write prose, Markdown and components with literal attributes. If every author of this repository has commit access, set `export const mdxTrust = "full"` in graft.config.ts and pass trust="full" to MdxBody. Code review is the control in that case, which is what ADR 0004 assumes.',
      details: { documents: executable.length, offenders: executable.slice(0, 20) },
    });
  }

  return docs.sort((a, b) =>
    a.collection === b.collection
      ? a.slug.localeCompare(b.slug)
      : a.collection.localeCompare(b.collection),
  );
}

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const docs = readDocs(options.contentDir, options.collections, {
    mdxTrust: options.mdxTrust,
  });
  const gitSha = options.gitSha === undefined ? resolveGitSha(options.contentDir) : options.gitSha;
  const changes = await projectBranchContent(
    options.db,
    docs.map((doc) => ({
      collection: doc.collection,
      slug: doc.slug,
      data: doc.data,
      body: doc.body,
      contentHash: doc.contentHash,
      sourcePath: doc.sourcePath,
    })),
    {
      branchId: options.branchId ?? "main",
      gitSha,
      knownCollections: Object.keys(options.collections),
      pruneUnknown: options.pruneUnknown,
    },
  );
  return { count: docs.length, docs, changes, gitSha };
}

export interface CompileStaticOptions {
  contentDir: string;
  collections: Record<string, AnyCollection>;
  /** Artifact path, e.g. <project>/.graft/index.db. */
  indexPath: string;
  /** As in CompileOptions: omit to auto-resolve, null to skip. */
  gitSha?: string | null;
  /**
   * How much of MDX authored bodies may be. Defaults to "restricted", matching
   * MdxBody, so a document that compiles is a document that renders. From
   * `export const mdxTrust` in graft.config.ts.
   */
  mdxTrust?: MdxTrust;
}

/**
 * The static-mode sibling of `compile`: same validate step (readDocs), but the
 * projection target is the SQLite artifact — no database, no env. Branching is
 * git's job here, so there is no branchId; the artifact records "main".
 */
export async function compileStatic(options: CompileStaticOptions): Promise<CompileResult> {
  const docs = readDocs(options.contentDir, options.collections, {
    mdxTrust: options.mdxTrust,
  });
  const gitSha = options.gitSha === undefined ? resolveGitSha(options.contentDir) : options.gitSha;
  const changes = await projectStaticContent(
    docs.map((doc) => ({
      collection: doc.collection,
      slug: doc.slug,
      data: doc.data,
      body: doc.body,
      contentHash: doc.contentHash,
      sourcePath: doc.sourcePath,
    })),
    { path: options.indexPath, gitSha },
  );
  return { count: docs.length, docs, changes, gitSha };
}

/** HEAD commit of the repo containing `cwd`, or null (no git, no repo — never throws). */
export function resolveGitSha(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
