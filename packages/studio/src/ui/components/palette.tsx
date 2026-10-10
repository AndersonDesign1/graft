import { Command } from "cmdk";
import { useEffect, useState } from "react";
import type { EditorComponentSpec } from "@usegraft/contracts";
import type { EntryList, EntrySummary } from "../../editor-types";
import { api, qs } from "../lib/api";
import { canInsert, insertBlock } from "../lib/editor-insert";
import type { DevView } from "../lib/route";
import {
  collectionLabel,
  editableCollections,
  publishVerb,
  singular,
  useStudio,
} from "../lib/studio";
import {
  IconApprovals,
  IconBranches,
  IconChanges,
  IconComponentBlock,
  IconFile,
  IconHistory,
  IconOverview,
  IconSchema,
  IconSettings,
  type IconComponent,
} from "./icons";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const DEVELOPER: Array<[DevView, string, IconComponent]> = [
  ["overview", "Health", IconOverview],
  ["schema", "Schema", IconSchema],
  ["history", "History", IconHistory],
  ["branches", "Branches", IconBranches],
  ["approvals", "Approvals", IconApprovals],
  ["settings", "Settings", IconSettings],
];

/**
 * ⌘K: find any entry by name, jump anywhere, create, publish.
 *
 * Entry search goes to the server (each collection's `/entries?q=`), so it
 * works the same on a catalog of fifty or five thousand. Deliberately
 * unanimated: it is opened by keyboard many times a session, and an entrance
 * transition on a keyboard action reads as lag however short.
 */
export function CommandPalette({
  open,
  onOpenChange,
  components,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project's component declarations, for the insert group. */
  components: readonly EditorComponentSpec[];
}) {
  const { schema, drafts, navigate, openPublish, openCreate } = useStudio();
  const collections = editableCollections(schema.data);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EntrySummary[]>([]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    // Drop the last search's hits at once: each item's value carries the
    // current query, so a stale hit would look like a match for this one.
    setHits([]);
    if (!open || term.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(
        collections.map((collection) =>
          api<EntryList>(`/entries${qs({ collection: collection.name, q: term, limit: 6 })}`)
            .then((list) => list.items)
            .catch(() => [] as EntrySummary[]),
        ),
      ).then((groups) => !cancelled && setHits(groups.flat()));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, schema.data]);

  // Recomputed on open: whether an editor is mounted changes as the person
  // moves around, and `canInsert()` is not React state.
  const insertable = open ? components.filter((spec) => spec.snippet && canInsert()) : [];
  const unpublished = drafts.data?.changes.length ?? 0;

  const go = (fn: () => void): void => {
    fn();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="palette">
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <Command label="Search and commands" loop shouldFilter={true}>
          <div className="palette-input">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Find an entry, or type a command…"
            />
            <kbd>Esc</kbd>
          </div>
          <Command.List className="palette-list">
            <Command.Empty className="palette-empty">
              {query.trim().length < 2 ? "Type to search." : "Nothing matches."}
            </Command.Empty>

            {hits.length > 0 ? (
              <Command.Group heading="Entries" className="palette-group">
                {hits.map((hit) => (
                  <Command.Item
                    key={hit.path}
                    value={`${hit.title} ${hit.slug} ${hit.collection} ${query}`}
                    className="palette-item"
                    onSelect={() =>
                      go(() =>
                        navigate({ view: "entry", collection: hit.collection, slug: hit.slug }),
                      )
                    }
                  >
                    <IconFile size={14} />
                    <span className="palette-item-label">{hit.title}</span>
                    <span className="palette-item-hint">{collectionLabel(hit.collection)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {insertable.length > 0 ? (
              <Command.Group heading="Insert into content" className="palette-group">
                {insertable.map((spec) => (
                  <Command.Item
                    key={spec.component}
                    value={`insert ${spec.component} ${spec.label ?? ""}`}
                    className="palette-item"
                    onSelect={() => go(() => insertBlock(spec.snippet ?? ""))}
                  >
                    <IconComponentBlock size={14} />
                    <span className="palette-item-label">{spec.label ?? spec.component}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            <Command.Group heading="Go to" className="palette-group">
              <Command.Item
                value="go home"
                className="palette-item"
                onSelect={() => go(() => navigate({ view: "home" }))}
              >
                <IconOverview size={14} />
                <span className="palette-item-label">Home</span>
              </Command.Item>
              {collections.map((collection) => (
                <Command.Item
                  key={collection.name}
                  value={`go ${collection.name}`}
                  className="palette-item"
                  onSelect={() =>
                    go(() => navigate({ view: "collection", collection: collection.name }))
                  }
                >
                  <IconFile size={14} />
                  <span className="palette-item-label">{collectionLabel(collection.name)}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Create" className="palette-group">
              {collections.map((collection) => (
                <Command.Item
                  key={collection.name}
                  value={`new create ${singular(collection.name)}`}
                  className="palette-item"
                  onSelect={() => go(() => openCreate(collection.name))}
                >
                  <span className="palette-plus" aria-hidden="true">
                    +
                  </span>
                  <span className="palette-item-label">New {singular(collection.name)}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Publish" className="palette-group">
              <Command.Item
                value="publish review changes commit"
                className="palette-item"
                onSelect={() => go(openPublish)}
              >
                <IconChanges size={14} />
                <span className="palette-item-label">{publishVerb(drafts.data?.publish)}…</span>
                <span className="palette-item-hint">
                  {unpublished === 0 ? "nothing waiting" : `${unpublished} waiting`}
                </span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Developer" className="palette-group">
              {DEVELOPER.map(([view, label, Icon]) => (
                <Command.Item
                  key={view}
                  value={`developer ${label} ${view}`}
                  className="palette-item"
                  onSelect={() => go(() => navigate({ view }))}
                >
                  <Icon size={14} />
                  <span className="palette-item-label">{label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
