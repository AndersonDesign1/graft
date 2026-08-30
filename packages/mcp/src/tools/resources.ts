/**
 * Content as MCP resources.
 *
 * A tool call is a *request to do something*; a resource is *a thing that
 * exists*, addressed by URI, which a client can list, attach to a conversation,
 * and re-read without spending a turn deciding to. Graft's documents have been
 * reachable only as tool output, so attaching one to a conversation meant an
 * agent calling `get_content` and pasting the answer. They are files with
 * stable paths — the most resource-shaped thing in the product.
 *
 * URIs are `graft://<branch>/<collection>/<slug>`. The branch is baked into the
 * template rather than left as a variable, because a server is pinned to one
 * branch and a URI naming a branch it cannot serve would be a URI it has to
 * refuse. What the client fills in is what the server can actually vary.
 *
 * Reads come from the authored files, not the index — git is the source of
 * truth, and a resource that answered from the last compile would hand back
 * something the working tree has already moved past. It also means resources
 * work on a static project with no database at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GraftError, type SchemaDescription } from "@usegraft/contracts";
import { readCollectionDocs } from "@usegraft/compiler";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireCollection } from "../content-hints";
import { teachAssetFields } from "../tool-helpers";
import { guardedResource } from "../tool-result";
import type { RegisterTools } from "./deps";
import { documentUri, documentUriTemplate, schemaUri } from "./resource-uri";

/** Authored documents live in files; db-authoritative rows have none to serve. */
const isFileAuthoritative = (authority: string | undefined): boolean =>
  authority !== "db-authoritative";

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * Documents as resources. The public documentation mount registers this and
 * not the schema resource below, which carries the function surface.
 */
export const registerDocumentResources: RegisterTools = (server, deps) => {
  const { branchId, collections, contentDir } = deps;

  const fileCollections = (): string[] =>
    Object.values(collections)
      .filter((collection) => isFileAuthoritative(collection.describe().authority))
      .map((collection) => collection.describe().name);

  /** Every authored document, read from disk. Skips a collection that fails to
   *  parse rather than failing the whole listing: one malformed file should not
   *  make every other document unlistable. */
  const allDocuments = (): Array<{
    collection: string;
    slug: string;
    sourcePath: string;
    title?: string;
    description?: string;
  }> => {
    const out = [];
    for (const name of fileCollections()) {
      try {
        for (const doc of readCollectionDocs(contentDir, name, collections[name])) {
          out.push({
            collection: name,
            slug: doc.slug,
            sourcePath: doc.sourcePath,
            title: asString(doc.data.title),
            description: asString(doc.data.description),
          });
        }
      } catch {
        /* a collection whose files do not parse is skipped, not fatal */
      }
    }
    return out;
  };

  server.registerResource(
    "document",
    new ResourceTemplate(documentUriTemplate(branchId), {
      list: () => ({
        resources: allDocuments().map((doc) => ({
          uri: documentUri(branchId, doc.collection, doc.slug),
          name: `${doc.collection}/${doc.slug}`,
          title: doc.title ?? doc.slug,
          description: doc.description ?? `Authored MDX at ${doc.sourcePath}`,
          mimeType: "text/markdown",
        })),
      }),
      // The URI variables autocomplete from what actually exists, and the slug
      // list narrows to the collection already chosen — the context carries the
      // variables filled in so far.
      complete: {
        collection: (value) => fileCollections().filter((name) => name.startsWith(value)),
        slug: (value, context) => {
          const chosen = context?.arguments?.collection;
          return allDocuments()
            .filter((doc) => chosen === undefined || doc.collection === chosen)
            .map((doc) => doc.slug)
            .filter((slug) => slug.startsWith(value));
        },
      },
    }),
    {
      title: "Authored document",
      description:
        "One MDX document as authored, frontmatter and body, read from the content directory rather than the index — so it reflects the working tree, not the last compile. Attach it as context; edit it with write_content.",
      mimeType: "text/markdown",
    },
    (uri, variables) =>
      guardedResource(() => {
        const collectionName = String(variables.collection);
        const slug = String(variables.slug);
        const collection = requireCollection(collections, collectionName);

        if (!isFileAuthoritative(collection.describe().authority)) {
          throw new GraftError({
            code: "AUTHORITY_MISMATCH",
            message: `Collection "${collectionName}" is db-authoritative — its records live in Postgres, not as MDX files, so they have no document resource.`,
            fix: "Read these through the collection's typed functions (see list_functions), not as a resource.",
            details: { collection: collectionName, authority: collection.describe().authority },
          });
        }

        // findDoc is a parse; the resource wants the bytes the author wrote, so
        // locate through the parse and then read the file itself.
        const docs = readCollectionDocs(contentDir, collectionName, collection);
        const doc = docs.find((candidate) => candidate.slug === slug);
        if (!doc) {
          throw new GraftError({
            code: "DOCUMENT_NOT_FOUND",
            message: `No document "${slug}" in collection "${collectionName}".`,
            fix: `Known slugs: ${docs.map((d) => d.slug).join(", ") || "(none)"}. List the document resources, or author it with write_content.`,
            details: { collection: collectionName, slug },
          });
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: readFileSync(join(contentDir, ...doc.sourcePath.split("/")), "utf8"),
            },
          ],
        };
      }),
  );
};

/**
 * The schema as a resource, not only as a tool call. It is the one piece of
 * context an agent wants attached for a whole session rather than fetched once
 * and forgotten, and it is the same payload describe_schema returns — which is
 * also why it stays off the public mount.
 */
export const registerSchemaResource: RegisterTools = (server, deps) => {
  const { branchId, collections, functionsByName } = deps;

  server.registerResource(
    "schema",
    schemaUri(branchId),
    {
      title: "Project schema",
      description:
        "Every collection with its typed fields, and every registered function — the same payload as describe_schema. Attach it once instead of calling the tool each time.",
      mimeType: "application/json",
    },
    (uri) => {
      const description: SchemaDescription = {
        collections: Object.values(collections).map((collection) => {
          const descriptor = collection.describe();
          return { ...descriptor, fields: descriptor.fields.map(teachAssetFields) };
        }),
        functions: [...functionsByName.values()].map((fn) => fn.describe()),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(description, null, 2),
          },
        ],
      };
    },
  );
};
