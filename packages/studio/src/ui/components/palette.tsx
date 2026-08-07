import { useEffect, useMemo, useRef, useState } from "react";
import type { BranchList, ContentTree } from "../../types";
import { IconSearch } from "./icons";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import type { Route, ViewId } from "../lib/route";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

const NAV_LABELS: Array<[ViewId, string]> = [
  ["overview", "Overview"],
  ["collections", "Collections"],
  ["schema", "Schema"],
  ["approvals", "Approvals"],
  ["branches", "Branches"],
  ["history", "History"],
  ["settings", "Settings"],
];

/**
 * ⌘K palette on Base UI's Dialog — focus is trapped and returned, the page
 * behind goes inert, Escape closes.
 *
 * Deliberately unanimated: it is opened by keyboard many times a session, and
 * an entrance transition on a keyboard action reads as lag however short it is.
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
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    for (const [view, label] of NAV_LABELS) {
      out.push({ id: `go:${view}`, label, group: "Go to", run: () => navigate({ view }) });
    }
    out.push({
      id: "action:compile",
      label: "Compile this branch",
      hint: "Refresh the content index from disk",
      group: "Actions",
      run: onCompile,
    });
    for (const collection of tree?.collections ?? []) {
      for (const doc of collection.documents) {
        out.push({
          id: `doc:${collection.name}/${doc.slug}`,
          label: doc.title ?? doc.slug,
          hint: doc.sourcePath,
          group: collection.name,
          run: () =>
            navigate({ view: "collections", collection: collection.name, slug: doc.slug }),
        });
      }
    }
    for (const b of branches?.branches ?? []) {
      out.push({
        id: `branch:${b.name}`,
        label: b.name,
        hint: b.parent ? `branch ← ${b.parent}` : "branch · root",
        group: "Switch branch",
        run: () => onSelectBranch(b.name),
      });
    }
    return out;
  }, [tree, branches, navigate, onSelectBranch, onCompile]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 40);
    return commands
      .filter((c) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const run = (command: Command | undefined): void => {
    if (!command) return;
    command.run();
    onOpenChange(false);
  };

  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="palette-input">
          <IconSearch size={16} />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={query}
            placeholder="Jump to a document, switch branch, run a command…"
            aria-label="Command palette"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[index]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <li className="palette-empty">No matches.</li>
          ) : (
            results.map((command, i) => {
              const header = command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                <li key={command.id}>
                  {header ? <p className="palette-group">{header}</p> : null}
                  <button
                    type="button"
                    className="palette-item"
                    data-active={i === index}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(command)}
                  >
                    <span className="palette-item-label">{command.label}</span>
                    {command.hint ? <span className="palette-item-hint">{command.hint}</span> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
