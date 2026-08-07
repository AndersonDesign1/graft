import { Command } from "cmdk";
import { useEffect, useMemo } from "react";
import type { BranchList, ContentTree } from "../../types";
import {
  IconBranches,
  IconCompile,
  IconFile,
  IconOverview,
  IconSchema,
  IconSettings,
  IconApprovals,
  IconHistory,
  type IconComponent,
} from "./icons";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import type { Route, ViewId } from "../lib/route";

const NAV: Array<[ViewId, string, IconComponent]> = [
  ["overview", "Overview", IconOverview],
  ["collections", "Collections", IconFile],
  ["schema", "Schema", IconSchema],
  ["approvals", "Approvals", IconApprovals],
  ["branches", "Branches", IconBranches],
  ["history", "History", IconHistory],
  ["settings", "Settings", IconSettings],
];

/**
 * ⌘K palette on cmdk, inside a Base UI dialog.
 *
 * cmdk owns the list semantics — filtering, scoring, roving selection, the
 * combobox ARIA contract — which is a surprising amount of behaviour to get
 * right by hand and the part users notice when it is wrong.
 *
 * Deliberately unanimated: it is opened by keyboard many times a session, and
 * an entrance transition on a keyboard action reads as lag however short.
 */
export function CommandPalette({
  open,
  onOpenChange,
  tree,
  branches,
  navigate,
  onSelectBranch,
  onCompile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: ContentTree | null;
  branches: BranchList | null;
  navigate: (route: Route) => void;
  onSelectBranch: (name: string) => void;
  onCompile: () => void;
}) {
  const documents = useMemo(
    () =>
      (tree?.collections ?? []).flatMap((collection) =>
        collection.documents.map((doc) => ({ collection: collection.name, doc })),
      ),
    [tree],
  );

  // Escape is handled by the dialog; cmdk only needs to not fight it.
  useEffect(() => {
    if (!open) return;
    return () => undefined;
  }, [open]);

  const go = (fn: () => void): void => {
    fn();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command label="Command palette" loop>
          <div className="palette-input">
            <Command.Input placeholder="Jump to a document, switch branch, run a command…" />
            <kbd>Esc</kbd>
          </div>
          <Command.List className="palette-list">
            <Command.Empty className="palette-empty">No matches.</Command.Empty>

            <Command.Group heading="Go to" className="palette-group">
              {NAV.map(([view, label, Icon]) => (
                <Command.Item
                  key={view}
                  value={`go ${label}`}
                  className="palette-item"
                  onSelect={() => go(() => navigate({ view }))}
                >
                  <Icon size={14} />
                  <span className="palette-item-label">{label}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Actions" className="palette-group">
              <Command.Item
                value="compile branch index"
                className="palette-item"
                onSelect={() => go(onCompile)}
              >
                <IconCompile size={14} />
                <span className="palette-item-label">Compile this branch</span>
                <span className="palette-item-hint">Refresh the index from disk</span>
              </Command.Item>
            </Command.Group>

            {documents.length > 0 ? (
              <Command.Group heading="Documents" className="palette-group">
                {documents.map(({ collection, doc }) => (
                  <Command.Item
                    key={`${collection}/${doc.slug}`}
                    value={`${collection} ${doc.title ?? doc.slug} ${doc.sourcePath}`}
                    className="palette-item"
                    onSelect={() =>
                      go(() => navigate({ view: "collections", collection, slug: doc.slug }))
                    }
                  >
                    <span className="dot" data-state={doc.state} />
                    <span className="palette-item-label">{doc.title ?? doc.slug}</span>
                    <span className="palette-item-hint">{doc.sourcePath}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {(branches?.branches.length ?? 0) > 0 ? (
              <Command.Group heading="Switch branch" className="palette-group">
                {branches?.branches.map((row) => (
                  <Command.Item
                    key={row.name}
                    value={`branch ${row.name}`}
                    className="palette-item"
                    onSelect={() => go(() => onSelectBranch(row.name))}
                  >
                    <IconBranches size={14} />
                    <span className="palette-item-label">{row.name}</span>
                    <span className="palette-item-hint">
                      {row.parent ? `← ${row.parent}` : "root"}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
