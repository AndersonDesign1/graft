/**
 * Content migrations — codemod-style transforms over authored MDX files.
 *
 * A migration exists because the schema moved ahead of the files (the
 * canonical case: a required field was added and compile now fails per file).
 * The transform receives each document's OLD frontmatter shape (untyped — the
 * schema no longer describes it) and returns the NEW shape, which is validated
 * against the collection's current schema before anything is written. Files
 * are rewritten in place, so the migration lands as a reviewable git commit —
 * git stays authoritative; the index catches up on the next compile.
 */
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection, DocumentData } from "@usegraft/core";

/** What the transform sees per document: the old, pre-migration shape. */
export interface ContentMigrationDoc {
  slug: string;
  /** `<collection>/<file>.mdx`, relative to the content root. */
  sourcePath: string;
  /** Raw frontmatter as authored (minus `slug`) — the OLD shape, so untyped. */
  data: Record<string, unknown>;
  /** The MDX body as authored. */
  body: string;
}

/** What the transform returns: the new frontmatter (and optionally a new body). */
export interface ContentMigrationChange<TData> {
  data: TData;
  /** Omit to keep the body as-is. */
  body?: string;
}

export interface ContentMigrationOptions<TCollection extends AnyCollection> {
  collection: TCollection;
  /** One line for `graft migrate` listings: what this migration does and why. */
  description: string;
  transform: (
    doc: ContentMigrationDoc,
  ) =>
    | ContentMigrationChange<DocumentData<TCollection>>
    | Promise<ContentMigrationChange<DocumentData<TCollection>>>;
}

export interface ContentMigration<TCollection extends AnyCollection = AnyCollection> {
  readonly kind: "content";
  readonly collection: TCollection;
  readonly description: string;
  readonly transform: ContentMigrationOptions<TCollection>["transform"];
}

export type AnyContentMigration = ContentMigration<AnyCollection>;

export function defineContentMigration<TCollection extends AnyCollection>(
  options: ContentMigrationOptions<TCollection>,
): ContentMigration<TCollection> {
  if (options.collection.authority === "db-authoritative") {
    throw new GraftError({
      code: "AUTHORITY_MISMATCH",
      message: `Content migrations transform files, but collection "${options.collection.name}" is db-authoritative — its records are Postgres rows.`,
      fix: `Use defineDataMigration from "@usegraft/core" for db-authoritative collections; defineContentMigration is only for collections whose documents are files.`,
      details: { collection: options.collection.name, authority: options.collection.authority },
    });
  }
  return {
    kind: "content",
    collection: options.collection,
    description: options.description,
    transform: options.transform,
  };
}
