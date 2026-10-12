/**
 * References between documents that point at nothing: a product whose
 * category was deleted, a post whose author was renamed. Found from the
 * schema's `reference` fields, top-level and inside arrays and objects.
 */
import type { FieldDescriptor } from "@usegraft/contracts";
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

/** Every reference whose target is not among `docs`. */
export function findBrokenReferences(
  docs: ProjectedDoc[],
  collections: Record<string, AnyCollection>,
): BrokenReference[] {
  const present = new Set(docs.map((doc) => `${doc.collection}/${doc.slug}`));
  const broken: BrokenReference[] = [];
  for (const doc of docs) {
    const collection = collections[doc.collection];
    if (!collection) continue;
    for (const descriptor of collection.describe().fields) {
      walk(descriptor, doc.data[descriptor.name], descriptor.name, (field, to, slug) => {
        // A reference into a collection kept in the database (records) is
        // not a document, so it can't be checked here.
        if (collections[to]?.authority === "db-authoritative") return;
        if (!present.has(`${to}/${slug}`))
          broken.push({ sourcePath: doc.sourcePath, field, to, slug });
      });
    }
  }
  return broken;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
