/**
 * The content explorer — collections and their documents in the sidebar.
 *
 * This replaces the separate list pane. Two reasons it earns the space:
 *
 *  1. It removes a whole column. Browsing content is *navigation*, and the
 *     sidebar is already where navigation lives; having a nav rail and a
 *     nav pane side by side was the fourth column that made the workspace
 *     feel cramped.
 *  2. Every collection can carry a sync bar — a hairline showing how much of
 *     it is in sync, drifted or unindexed. That is Graft's central state
 *     rendered as one glanceable object per collection, which a flat list of
 *     names cannot do.
 *
 * Documents nest under their site section, in publication order, so the tree
 * mirrors the site rather than the filesystem.
 */
import { useEffect, useMemo, useState } from "react";
import type { ContentTreeCollection, ContentTreeDoc } from "../../types";
import { IconCaretDown, IconDatabase, IconSearch, IconSort } from "./icons";
import { StatusDot } from "./primitives";
import { CollectionMark } from "./collection-icon";
import { TreeSkeleton } from "./skeletons";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "./ui/menu";
import { relativeTime } from "../lib/format";

export type SortMode = "site" | "alpha" | "updated";
export type Filter = "all" | "drifted" | "unindexed";

const SORTS: Array<{ id: SortMode; label: string; hint: string }> = [
  { id: "site", label: "Site order", hint: "Section, then order — as published" },
  { id: "alpha", label: "A–Z", hint: "By title" },
  { id: "updated", label: "Recently indexed", hint: "Newest compile first" },
];

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All documents" },
  { id: "drifted", label: "Out of sync only" },
  { id: "unindexed", label: "Not indexed only" },
];

/** Proportional sync bar. One row per collection, no legend needed. */
function SyncBar({ documents }: { documents: ContentTreeDoc[] }) {
  const total = documents.length;
  if (total === 0) return null;
  const count = (state: ContentTreeDoc["state"]) =>
    documents.reduce((n, d) => n + (d.state === state ? 1 : 0), 0);
  const segments: Array<[ContentTreeDoc["state"], number]> = [
    ["synced", count("synced")],
    ["drifted", count("drifted")],
    ["unindexed", count("unindexed")],
    ["orphaned", count("orphaned")],
  ];
  return (
    <span className="sync-bar" aria-hidden="true">
      {segments.map(([state, n]) =>
        n === 0 ? null : (
          <span key={state} data-state={state} style={{ flexGrow: n }} />
        ),
      )}
    </span>
  );
}

function sortDocs(docs: ContentTreeDoc[], sort: SortMode): ContentTreeDoc[] {
  if (sort === "site") return docs; // the API owns publication order
  const out = [...docs];
  if (sort === "alpha") {
    out.sort((a, b) => (a.title ?? a.slug).localeCompare(b.title ?? b.slug));
  } else {
    out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return out;
}

function groupDocs(
  docs: ContentTreeDoc[],
  sort: SortMode,
): Array<[string, ContentTreeDoc[]]> {
  const sorted = sortDocs(docs, sort);
  // Sections only mean something in publication order.
  if (sort !== "site" || !sorted.some((d) => d.section)) return [["", sorted]];
  const sections = new Map<string, ContentTreeDoc[]>();
  for (const doc of sorted) {
    const key = doc.section ?? "Ungrouped";
    const list = sections.get(key);
    if (list) list.push(doc);
    else sections.set(key, [doc]);
  }
  return [...sections.entries()];
}

export function ContentExplorer({
  collections,
  loading,
  activeCollection,
  activeSlug,
  onSelectCollection,
  onSelectDocument,
  onSearch,
}: {
  collections: ContentTreeCollection[];
  loading: boolean;
  activeCollection?: string;
  activeSlug?: string;
  /**
   * `firstSlug` is the first document currently visible in that collection —
   * after the active filter and sort, not just the first on disk — so opening
   * a collection lands on something real instead of an empty pane.
   */
  onSelectCollection: (name: string, firstSlug?: string) => void;
  onSelectDocument: (collection: string, slug: string) => void;
  /** Opens the command palette — the one place content is searched. */
  onSearch: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortMode>("site");
  const [filter, setFilter] = useState<Filter>("all");

  // The collection you are working in is always open; you never have to
  // re-open the thing you just clicked.
  useEffect(() => {
    if (activeCollection) setExpanded((prev) => ({ ...prev, [activeCollection]: true }));
  }, [activeCollection]);

  // Text search moved to the palette. The tree filters by state only, which
  // is a different job: "show me what's out of sync" is a view of everything,
  // not a lookup of one thing.
  const filtered = useMemo(
    () =>
      collections.map((collection) => ({
        collection,
        documents: collection.documents.filter((d) => {
          if (filter === "drifted" && d.state === "synced") return false;
          if (filter === "unindexed" && d.state !== "unindexed") return false;
          return true;
        }),
      })),
    [collections, filter],
  );

  const filtering = filter !== "all";
  const hits = filtered.reduce((n, f) => n + f.documents.length, 0);

  return (
    <div className="tree">
      <div className="tree-head">
        <p className="rail-label">Content</p>
        <Menu>
          <MenuTrigger className="tree-tool" aria-label="Sort and filter" title="Sort and filter">
            <IconSort size={13} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Order</MenuLabel>
            {SORTS.map((option) => (
              <MenuItem
                key={option.id}
                data-active={sort === option.id}
                onClick={() => setSort(option.id)}
              >
                <span className="menu-item-label">{option.label}</span>
                <span className="menu-item-hint">{option.hint}</span>
              </MenuItem>
            ))}
            <MenuLabel>Show</MenuLabel>
            {FILTERS.map((option) => (
              <MenuItem
                key={option.id}
                data-active={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                <span className="menu-item-label">{option.label}</span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>

      {/* Not an input: searching content is what the palette is for, and two
          search affordances that behave differently is worse than one that
          always does the same thing. */}
      <button type="button" className="search search-tree" onClick={onSearch}>
        <IconSearch size={13} />
        <span>Find a document</span>
        <kbd>⌘K</kbd>
      </button>

      {filtering ? (
        <p className="tree-hint">
          {hits === 0 ? "Nothing matches" : `${hits} document${hits === 1 ? "" : "s"}`} ·{" "}
          {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()}
        </p>
      ) : null}

      {loading && collections.length === 0 ? <TreeSkeleton /> : null}
      {!loading && collections.length === 0 ? (
        <p className="tree-hint">No collections registered</p>
      ) : null}

      {filtered.map(({ collection, documents }) => {
        const isDb = collection.authority === "db";
        // While searching, open anything with a hit and skip the rest.
        const open = filtering ? documents.length > 0 : (expanded[collection.name] ?? false);
        if (filtering && documents.length === 0 && !isDb) return null;
        const groups = groupDocs(documents, sort);

        return (
          <div key={collection.name} className="tree-collection" data-open={open}>
            <div
              className="tree-collection-row"
              data-active={collection.name === activeCollection && !activeSlug}
            >
              <button
                type="button"
                className="tree-twisty"
                aria-label={open ? `Collapse ${collection.name}` : `Expand ${collection.name}`}
                aria-expanded={open}
                disabled={isDb || documents.length === 0}
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [collection.name]: !open }))
                }
              >
                <IconCaretDown size={11} />
              </button>
              <button
                type="button"
                className="tree-collection-main"
                onClick={() => {
                  // groups[0] is the first section in reading order, so its
                  // first entry is the document the site leads with.
                  const first = groups[0]?.[1][0]?.slug;
                  onSelectCollection(collection.name, isDb ? undefined : first);
                  if (!isDb) setExpanded((prev) => ({ ...prev, [collection.name]: true }));
                }}
              >
                <CollectionMark name={collection.name} authority={collection.authority} size="sm" />
                <span className="tree-collection-name">{collection.name}</span>
                {isDb ? (
                  <IconDatabase size={12} className="tree-db" />
                ) : (
                  <span className="tree-count" data-numeric="">
                    {documents.length}
                  </span>
                )}
              </button>
            </div>

            {isDb ? null : <SyncBar documents={collection.documents} />}

            {open && !isDb ? (
              <div className="tree-children">
                {groups.map(([section, docs]) => (
                  <div key={section || "_"}>
                    {section ? <p className="tree-section">{section}</p> : null}
                    {docs.map((doc) => (
                      <button
                        key={doc.slug}
                        type="button"
                        className="tree-doc"
                        data-active={
                          collection.name === activeCollection && doc.slug === activeSlug
                        }
                        title={doc.sourcePath}
                        onClick={() => onSelectDocument(collection.name, doc.slug)}
                      >
                        <StatusDot state={doc.state} />
                        <span className="tree-doc-title">{doc.title ?? doc.slug}</span>
                        <span className="tree-doc-meta" data-numeric="">
                          {doc.state === "unindexed" ? "new" : relativeTime(doc.updatedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                {documents.length === 0 ? (
                  <p className="tree-hint tree-hint-nested">Nothing here yet</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
