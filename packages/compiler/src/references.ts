/**
 * References between documents that point at nothing: a product whose
 * category was deleted, a post whose author was renamed. Found from the
 * schema's `reference` fields, top-level and inside arrays and objects.
 */
import { GraftError, type FieldDescriptor } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import type { ProjectedDoc } from "./parse";

export interface BrokenReference {
  /** The document holding the reference. */
  sourcePath: string;
  /** Dotted path to the field, with array indexes: `related.2`. */
  field: string;
  /** The collection the field points into, and the slug it names. */
  to: string;
  slug: string;
}

function walk(
  descriptor: FieldDescriptor,
  value: unknown,
  at: string,
  found: (field: string, to: string, slug: string) => void,
): void {
  if (value === undefined || value === null) return;
  if (descriptor.type === "reference" && descriptor.to && typeof value === "string") {
    found(at, descriptor.to, value);
    return;
  }
  const items = descriptor.items;
  if (descriptor.type === "array" && items && Array.isArray(value)) {
    value.forEach((item, i) => walk(items, item, `${at}.${i}`, found));
    return;
  }
  if (descriptor.type === "object" && descriptor.fields && isRecord(value)) {
    for (const child of descriptor.fields)
      walk(child, value[child.name], `${at}.${child.name}`, found);
  }
}

/** What the check reads from a document: where it is, and its fields. */
export type ReferencingDoc = Pick<ProjectedDoc, "collection" | "slug" | "data" | "sourcePath">;

/** The `collection/slug` keys a reference may resolve to. A Set, or anything that answers `has`. */
export type ReferenceTargets = Pick<ReadonlySet<string>, "has">;

/**
 * Every reference whose target is not among `docs`, nor among `elsewhere`:
 * the `collection/slug` keys of documents that exist but were not passed,
 * for a caller checking part of a larger whole.
 */
export function findBrokenReferences(
  docs: ReferencingDoc[],
  collections: Record<string, AnyCollection>,
  elsewhere: ReferenceTargets = new Set(),
): BrokenReference[] {
  const present = new Set(docs.map((doc) => `${doc.collection}/${doc.slug}`));
  const broken: BrokenReference[] = [];
  // describe() builds the field list afresh, so once per collection, not per document.
  const fieldsOf = new Map<string, FieldDescriptor[]>();
  for (const doc of docs) {
    const collection = collections[doc.collection];
    if (!collection) continue;
    let fields = fieldsOf.get(doc.collection);
    if (!fields) {
      fields = collection.describe().fields;
      fieldsOf.set(doc.collection, fields);
    }
    for (const descriptor of fields) {
      walk(descriptor, doc.data[descriptor.name], descriptor.name, (field, to, slug) => {
        // A reference into a collection kept in the database (records) is
        // not a document, so it can't be checked here.
        if (collections[to]?.authority === "db-authoritative") return;
        const target = `${to}/${slug}`;
        if (!present.has(target) && !elsewhere.has(target))
          broken.push({ sourcePath: doc.sourcePath, field, to, slug });
      });
    }
  }
  return broken;
}

/**
 * Check a change to some documents of a larger whole, such as one save or
 * one publish, against the documents that stay as they are. `validate` is
 * the caller's own check of the changed files, given the keys of every
 * document that stays, so their references can resolve to those. Then the
 * documents that stay are checked against what the change leaves: a
 * deletion or a new slug must not leave them pointing at nothing. Only
 * references this change breaks are refused; ones already broken are not
 * its to refuse. Throws CONTENT_REFERENCE_NOT_FOUND.
 */
export function checkChangedDocuments<T extends ReferencingDoc>(
  live: ReferencingDoc[],
  changedPaths: ReadonlySet<string>,
  collections: Record<string, AnyCollection>,
  validate: (staying: ReferenceTargets) => T[],
): T[] {
  const key = (doc: { collection: string; slug: string }) => `${doc.collection}/${doc.slug}`;
  const staying = live.filter((doc) => !changedPaths.has(doc.sourcePath));
  const docs = validate(new Set(staying.map(key)));
  const before = new Set(live.map(key));
  const stranded = findBrokenReferences(staying, collections, new Set(docs.map(key))).filter(
    (ref) => before.has(`${ref.to}/${ref.slug}`),
  );
  if (stranded.length > 0) throw brokenReferencesError(stranded);
  return docs;
}

/** The refusal for references that point at nothing, naming the first ten. */
export function brokenReferencesError(broken: BrokenReference[]): GraftError {
  const listed = broken
    .slice(0, 10)
    .map((ref) => `${ref.sourcePath} "${ref.field}" points at ${ref.to}/${ref.slug}`)
    .join("; ");
  const more = broken.length > 10 ? ` …and ${broken.length - 10} more` : "";
  const first = broken[0];
  return new GraftError({
    code: "CONTENT_REFERENCE_NOT_FOUND",
    message: `${broken.length} reference(s) name a document that doesn't exist: ${listed}${more}.`,
    fix: first
      ? `Create ${first.to}/${first.slug}, or change ${first.sourcePath}'s "${first.field}" to a document that exists. A reference names its target by slug, so renaming or deleting a document breaks every reference to it. \`graft check\` lists them all.`
      : "Point each reference at a document that exists.",
    details: { references: broken.slice(0, 50), total: broken.length },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
