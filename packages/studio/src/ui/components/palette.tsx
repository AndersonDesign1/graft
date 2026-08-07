import { useEffect, useMemo, useRef, useState } from "react";
import type { BranchList, ContentTree } from "../../types";
import { IconSearch } from "./icons";
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
 * ⌘K palette. Deliberately unanimated: it is opened by keyboard, dozens of
 * times a session, and an entrance animation on a keyboard action reads as
 * lag no matter how short it is.
 */
export function CommandPalette({
  open,
  onClose,
  tree,
  branches,
  navigate,
  onSelectBranch,
  onCompile,
}: {
  open: boolean;
  onClose: () => void;
  tree: ContentTree | null;
  branches: BranchList | null;
  navigate: (route: Route) => void;
  onSelectBranch: (name: string) => void;
  onCompile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    for (const [view, label] of NAV_LABELS) {
      out.push({
        id: `go:${view}`,
        label,
        group: "Go to",
        run: () => navigate({ view }),
      });
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
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  // Keep the active row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [index]);

  if (!open) return null;

  const run = (command: Command | undefined): void => {
    if (!command) return;
    command.run();
    onClose();
  };

  let lastGroup = "";

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to a document, switch branch, run a command…"
            aria-label="Command palette"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
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
                    {command.hint ? (
                      <span className="palette-item-hint">{command.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
