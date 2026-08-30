/**
 * Content tools — reading and authoring the MDX files git owns.
 *
 * Reads go to the files rather than the index, because git is authoritative and an agent must see the truth it can edit.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeDocument,
  parseDocument,
  readCollectionDocs,
  writeDocumentFile,
} from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { assertSafeMdx } from "@usegraft/mdx-safety";
import { assertSearchQuery, scopeChain } from "@usegraft/db";
import { z } from "zod";
import { findDoc, requireCollection } from "../content-hints";
import { assertSlugFree, invokeFunction } from "../tool-helpers";
import { guarded } from "../tool-result";
import { DESTROYS, READS, WRITES } from "./annotations";
import type { RegisterTools } from "./deps";

export const registerContentTools: RegisterTools = (server, deps) => {
  const {
    branchId,
    collections,
    contentDir,
    functions,
    getDeleteHandler,
    getScope,
    options,
    projectContent,
    requireScope,
    searchIndex,
    staticIndexPath,
  } = deps;

  server.registerTool(
    "list_content",
    {
      title: "List documents in a collection",
      annotations: READS,
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
      annotations: READS,
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
    "search_content",
    {
      title: "Full-text search across content",
      annotations: READS,
      description:
        'Search authored content by words, "quoted phrases", `or`, and -exclusions (websearch syntax). Searches the branch\'s effective content in the compiled Postgres index — on a preview branch that includes documents inherited from parent branches, with branch overrides winning — so results are as fresh as the last compile (write_content compiles automatically); every hit carries the sourcePath of the file to edit. Ranking weights slug matches over frontmatter over body.',
      inputSchema: {
        query: z.string().describe('What to find, e.g. pricing "free tier" -enterprise'),
        collection: z
          .string()
          .optional()
          .describe("Restrict to one collection (default: all registered collections)"),
        limit: z.number().optional().describe("Max hits, best-ranked first (default 20)"),
      },
    },
    ({ query, collection: name, limit }) =>
      guarded(async () => {
        if (name !== undefined) requireCollection(collections, name);
        // Cheap input gates first — an invalid query never pays scope resolution.
        assertSearchQuery(query);
        const collectionNames = name === undefined ? Object.keys(collections) : [name];
        // A static artifact is a single compiled branch, so its "chain" is just
        // this branch; Postgres searches the resolved chain (leaf-first), the
        // same effective content readContent serves: inherited parent docs are
        // found, branch overrides win, tombstones hide (P4.1 overlay semantics).
        const chain = staticIndexPath === undefined ? scopeChain(await getScope()) : [branchId];
        const hits = await searchIndex({ query, chain, collections: collectionNames, limit });
        return {
          branch: branchId,
          chain,
          query,
          hits: hits.map(({ row, rank, snippet }) => ({
            collection: row.collection,
            slug: row.slug,
            sourcePath: row.sourcePath,
            rank,
            snippet,
            data: row.data,
          })),
        };
      }),
  );

  server.registerTool(
    "write_content",
    {
      title: "Write a document (create or update)",
      annotations: WRITES,
      description:
        "Author or update a document: validates the data against the collection schema, writes <contentDir>/<collection>/<slug>.mdx, and compiles the content tree into the database. Returns exactly what changed. Git is the version history: commit the file afterwards if you have the server's checkout; remote callers can't and needn't — the checkout's operator owns the commit.",
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
        requireScope("write_content", "content:write");
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
        const fullPath = join(contentDir, ...sourcePath.split("/"));
        // Updating an existing document must not rewrite frontmatter the author
        // (or an earlier agent) wrote — only a real data change re-serialises.
        // Content arriving over the wire is not operator-authored, and MDX is
        // code: rendering evaluates `{…}` and `import` as JavaScript on the
        // server. Refuse it here, before it is stored.
        assertSafeMdx(body ?? "", { label: `${name}/${slug}` });

        const existingRaw = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : undefined;
        const raw = composeDocument(existingRaw, data as Record<string, unknown>, body ?? "");
        // Validate before touching disk: schema + slug shape, same path compile uses.
        parseDocument(raw, collection, sourcePath);

        assertSlugFree(contentDir, name, collection, slug, sourcePath);

        writeDocumentFile(fullPath, raw);

        const result = await projectContent();
        return {
          written: sourcePath,
          branch: branchId,
          gitSha: result.gitSha,
          changes: result.changes,
        };
      }),
  );

  server.registerTool(
    "delete_content",
    {
      title: "Delete a document (human-gated)",
      annotations: DESTROYS,
      description:
        "Delete an authored document: removes <contentDir>/<collection>/<slug>.mdx and compiles, so the index soft-deletes it. DESTRUCTIVE and always human-gated — the first call files an approval and fails with its id; a human decides with `graft approve <id>` (or deny); then retry the SAME collection+slug with `approval: <id>` (the MCP form of the x-graft-approval header). Approvals are one-shot and bound to that exact input. Git is the version history: commit the deletion afterwards if you have the server's checkout; remote callers can't and needn't — the checkout's operator owns the commit.",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        slug: z.string().describe("Document slug to delete"),
        approval: z
          .string()
          .optional()
          .describe(
            "Approval id from a prior DESTRUCTIVE_OP_REQUIRES_APPROVAL response, after a human ran `graft approve <id>`.",
          ),
      },
    },
    ({ collection: name, slug, approval }) =>
      guarded(async () => {
        requireScope("delete_content", "content:write");
        const collection = requireCollection(collections, name);
        if (collection.authority === "db-authoritative") {
          throw new GraftError({
            code: "AUTHORITY_MISMATCH",
            message: `Collection "${name}" is db-authoritative — its records live in Postgres, not as MDX files.`,
            fix: "Delete records through the collection's typed functions (a destructive defineFunction over deleteRecord — see list_functions), not delete_content. delete_content is only for file-authoritative collections.",
            details: { collection: name, authority: collection.authority },
          });
        }
        // Fail fast on a missing document — never file an approval a human
        // would review for nothing.
        findDoc(contentDir, name, collection, slug);

        const { data, correlationId } = await invokeFunction(
          getDeleteHandler(),
          "delete_content",
          { collection: name, slug },
          { credential: options.defaultAuthorization, approval },
        );
        return { ...(data as Record<string, unknown>), correlationId };
      }),
  );

  const uploadRoot = options.localUploadRoot;
};
