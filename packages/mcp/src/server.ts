/**
 * The Graft MCP server — the agent surface over a project's content.
 *
 * Tools mirror the file-first model: reads come from the MDX files (git is
 * authoritative), writes go through the same validate → write file → compile
 * pipeline a human uses, so every change lands as a plain file a git commit can
 * carry. Every failure crossing this boundary is GraftError JSON with a `fix`.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compile, parseDocument } from "@graft/compiler";
import { GraftError, type SchemaDescription } from "@graft/contracts";
import type { AnyCollection } from "@graft/core";
import type { Database } from "@graft/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import matter from "gray-matter";
import { z } from "zod";
import { findDoc, readCollectionDocs, requireCollection } from "./content-files";
import { ERROR_KNOWLEDGE, explainCode } from "./explain";

export interface GraftMcpOptions {
  /** Absolute path to the content root (documents live at <contentDir>/<collection>/<slug>.mdx). */
  contentDir: string;
  collections: Record<string, AnyCollection>;
  db: Database;
  /** Content branch to project into. Defaults to "main". */
  branchId?: string;
  /** Server identity reported to MCP clients. */
  name?: string;
  version?: string;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: GraftError): ToolResult {
  const explanation = ERROR_KNOWLEDGE[error.code];
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { ...error.toJSON(), howToRecover: explanation.howToRecover },
          null,
          2,
        ),
      },
    ],
  };
}

/** Run a tool body, translating GraftErrors into agent-actionable tool failures. */
async function guarded(body: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return ok(await body());
  } catch (error) {
    if (error instanceof GraftError) return fail(error);
    throw error;
  }
}

export function createGraftMcp(options: GraftMcpOptions): McpServer {
  const { contentDir, collections, db } = options;
  const branchId = options.branchId ?? "main";

  const server = new McpServer({
    name: options.name ?? "graft",
    version: options.version ?? "0.0.0",
  });

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List every registered content collection (name, description, authority, field count). Start here to learn what kinds of content this project has.",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        branch: branchId,
        collections: Object.values(collections).map((collection) => {
          const descriptor = collection.describe();
          return {
            name: descriptor.name,
            description: descriptor.description,
            authority: descriptor.authority,
            fields: descriptor.fields.length,
          };
        }),
      })),
  );

  server.registerTool(
    "describe_schema",
    {
      title: "Describe the content schema",
      description:
        "Full schema introspection: every collection with its typed fields (name, type, optional, description). Documents also accept an optional kebab-case `slug` (defaults to the filename).",
      inputSchema: {},
    },
    () =>
      guarded((): SchemaDescription => {
        return {
          collections: Object.values(collections).map((collection) => collection.describe()),
          functions: [],
        };
      }),
  );

  server.registerTool(
    "list_content",
    {
      title: "List documents in a collection",
      description:
        "List every document in a collection, read from the authored MDX files (git is the source of truth). Returns slug, sourcePath, and frontmatter data.",
      inputSchema: {
        collection: z.string().describe("Collection name, as returned by list_collections"),
      },
    },
    ({ collection: name }) =>
      guarded(() => {
        const collection = requireCollection(collections, name);
        const docs = readCollectionDocs(contentDir, name, collection);
        return {
          collection: name,
          documents: docs.map((doc) => ({
            slug: doc.slug,
            sourcePath: doc.sourcePath,
            data: doc.data,
          })),
        };
      }),
  );

  server.registerTool(
    "get_content",
    {
      title: "Get one document",
      description:
        "Read a single document by collection + slug from the authored MDX files: validated frontmatter data, MDX body, and the file path to edit.",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        slug: z.string().describe("Document slug (kebab-case)"),
      },
    },
    ({ collection: name, slug }) =>
      guarded(() => {
        const collection = requireCollection(collections, name);
        const doc = findDoc(contentDir, name, collection, slug);
        return {
          collection: name,
          slug: doc.slug,
          sourcePath: doc.sourcePath,
          data: doc.data,
          body: doc.body,
        };
      }),
  );

  server.registerTool(
    "write_content",
    {
      title: "Write a document (create or update)",
      description:
        "Author or update a document: validates the data against the collection schema, writes <contentDir>/<collection>/<slug>.mdx, and compiles the content tree into the database. Returns exactly what changed. Commit the file to git afterwards — git is the version history.",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        slug: z
          .string()
          .describe("Document slug — kebab-case; becomes the filename and the URL segment"),
        data: z
          .record(z.string(), z.unknown())
          .describe("Frontmatter data; must satisfy the collection schema (see describe_schema)"),
        body: z.string().optional().describe("MDX body (markdown). Defaults to empty."),
      },
    },
    ({ collection: name, slug, data, body }) =>
      guarded(async () => {
        const collection = requireCollection(collections, name);

        if (collection.authority === "db-authoritative") {
          throw new GraftError({
            code: "AUTHORITY_MISMATCH",
            message: `Collection "${name}" is db-authoritative — its records live in Postgres, not as MDX files.`,
            fix: `Write this data through the collection's function endpoint (POST /api/fn/<name>, see llms.txt) instead of write_content. write_content is only for file-authoritative collections.`,
            details: { collection: name, authority: collection.authority },
          });
        }

        const frontmatterSlug = (data as Record<string, unknown>).slug;
        if (frontmatterSlug !== undefined && frontmatterSlug !== slug) {
          throw new GraftError({
            code: "INVALID_SLUG",
            message: `data.slug ("${String(frontmatterSlug)}") conflicts with the slug argument ("${slug}")`,
            fix: "Omit `slug` from data — the slug argument names the file and the document.",
            details: { slug, frontmatterSlug },
          });
        }

        const sourcePath = `${name}/${slug}.mdx`;
        const raw = matter.stringify(body ?? "", data);
        // Validate before touching disk: schema + slug shape, same path compile uses.
        parseDocument(raw, collection, sourcePath);

        assertSlugFree(contentDir, name, collection, slug, sourcePath);

        mkdirSync(join(contentDir, name), { recursive: true });
        writeFileSync(join(contentDir, ...sourcePath.split("/")), raw);

        const result = await compile({ contentDir, collections, db, branchId });
        return {
          written: sourcePath,
          branch: branchId,
          gitSha: result.gitSha,
          changes: result.changes,
        };
      }),
  );

  server.registerTool(
    "explain_error",
    {
      title: "Explain a Graft error",
      description:
        "Given a GraftError code or its JSON, explain what it means, its typical causes, and how to recover. Use whenever a tool call or compile fails.",
      inputSchema: {
        code: z.string().optional().describe("An error code, e.g. SCHEMA_VALIDATION_FAILED"),
        error: z.string().optional().describe("A full GraftError JSON string, if you have one"),
      },
    },
    ({ code, error }) =>
      guarded(() => {
        let parsed: { error?: string; fix?: string; message?: string } | undefined;
        if (error) {
          try {
            parsed = JSON.parse(error);
          } catch {
            /* not JSON — fall through to the code path */
          }
        }
        const effective = code ?? parsed?.error;
        if (!effective) {
          return {
            knownCodes: Object.keys(ERROR_KNOWLEDGE),
            hint: "Pass `code` or the GraftError JSON as `error`.",
          };
        }
        const explanation = explainCode(effective);
        if (!explanation) {
          return {
            code: effective,
            known: false,
            knownCodes: Object.keys(ERROR_KNOWLEDGE),
            hint: "Not a Graft error code. If this came from another system, resolve it there.",
          };
        }
        return {
          ...explanation,
          // The specific fix from the actual error beats the general recovery advice.
          specificFix: parsed?.fix,
          message: parsed?.message,
        };
      }),
  );

  return server;
}

/**
 * Reject a write whose slug is already claimed by a different file. Files that
 * currently fail to parse are skipped — they can't reliably claim a slug, and
 * compile() will surface them with their own fix.
 */
function assertSlugFree(
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
