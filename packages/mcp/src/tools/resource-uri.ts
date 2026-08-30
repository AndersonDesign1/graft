/**
 * The one place a document's resource URI is spelled.
 *
 * Both halves need it: the resource registration serves these URIs, and the
 * content tools link to them. Two copies of a URI scheme is two things to keep
 * in step, and the failure would be silent — a link pointing at a URI nothing
 * serves reads as a broken client rather than a server that disagrees with
 * itself.
 */
import type { ResourceLink } from "../tool-result";

/** `graft://<branch>/<collection>/<slug>` — one authored document. */
export const documentUri = (branchId: string, collection: string, slug: string): string =>
  `graft://${branchId}/${collection}/${slug}`;

/** `graft://<branch>/schema` — the project's collections and functions. */
export const schemaUri = (branchId: string): string => `graft://${branchId}/schema`;

/** The RFC 6570 template a client fills in to address any document. */
export const documentUriTemplate = (branchId: string): string =>
  `graft://${branchId}/{collection}/{slug}`;

/** A document as a `resource_link` content block, for a tool result. */
export const documentLink = (branchId: string, collection: string, slug: string): ResourceLink => ({
  type: "resource_link",
  uri: documentUri(branchId, collection, slug),
  name: `${collection}/${slug}`,
  mimeType: "text/markdown",
});
