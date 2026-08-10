import { Command } from "cmdk";
import { useEffect, useMemo } from "react";
import type { EditorComponentSpec } from "@usegraft/contracts";
import type { BranchList, ContentTree } from "../../types";
import {
  IconBranches,
  IconCompile,
  IconComponentBlock,
  IconFile,
  IconOverview,
  IconSchema,
  IconSettings,
  IconApprovals,
  IconHistory,
  type IconComponent,
} from "./icons";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { canInsert, insertBlock } from "../lib/editor-insert";
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
  components,
  navigate,
  onSelectBranch,
  onCompile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: ContentTree | null;
  branches: BranchList | null;
  /** The project's component declarations, for the insert group. */
  components: readonly EditorComponentSpec[];
  navigate: (route: Route) => void;
  onSelectBranch: (name: string) => void;
  onCompile: () => void;
}) {
  // Recomputed on open rather than memoised on `components`: whether an editor
  // is mounted changes as the operator moves around, and `canInsert()` is not
  // React state the memo could depend on.
  const insertable = open ? components.filter((spec) => spec.snippet && canInsert()) : [];

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

            {/* Only when a rich editor is mounted and the component declared a
                snippet. Crepe's own `/` menu covers markdown structure; what it
                cannot know is this project's components, which is the gap. */}
            {insertable.length > 0 ? (
              <Command.Group heading="Insert into document" className="palette-group">
                {insertable.map((spec) => (
                  <Command.Item
                    key={spec.component}
                    value={`insert ${spec.component} ${spec.label ?? ""}`}
                    className="palette-item"
                    onSelect={() => go(() => insertBlock(spec.snippet ?? ""))}
                  >
                    <IconComponentBlock size={14} />
                    <span className="palette-item-label">{spec.label ?? spec.component}</span>
                    <span className="palette-item-hint">{`<${spec.component}>`}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

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
