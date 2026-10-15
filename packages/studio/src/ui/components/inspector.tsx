/**
 * The panel beside the document: what this entry is and what changed in it.
 * It hides with one key (⌘\ or Ctrl+\) for a full-width canvas, and the choice
 * is remembered in this browser. Below 1280px it opens over the document
 * instead of beside it.
 */
import { Tabs as TabsPrimitive } from "@base-ui-components/react/tabs";
import { useCallback, useEffect, useState } from "react";
import type { DraftsDto, EntryStatus, VersionDto, WorkspaceDto } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { doneWord } from "../lib/studio";
import { DiffView } from "./diff-view";
import { HistoryPanel } from "./history-panel";
import { IconClose } from "./icons";
import { shortcut } from "../lib/keys";

const KEY = "graft-studio:inspector";

/** Whether the inspector is open, remembered per browser, and its toggle. */
export function useInspector(): [boolean, () => void, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      // Closed by default where there is no room for it beside the document.
      return saved === null ? window.innerWidth >= 1280 : saved === "open";
    } catch {
      return window.innerWidth >= 1280;
    }
  });
  const set = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(KEY, next ? "open" : "closed");
    } catch {
      /* storage unavailable: the choice lasts this visit */
    }
  }, []);
  const toggle = useCallback(() => set(!open), [open, set]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggle();
      } else if (
        // Over the document it is a sheet, and a sheet closes with Escape.
        event.key === "Escape" &&
        open &&
        !event.defaultPrevented &&
        window.matchMedia("(width < 80rem)").matches
      ) {
        set(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, set, toggle]);

  return [open, toggle, set];
}

function statusWord(status: EntryStatus, action: DraftsDto["publish"] | undefined): string {
  const done = doneWord(action);
  if (status === "published") return done.charAt(0).toUpperCase() + done.slice(1);
  if (status === "new") return `New, not ${done} yet`;
  if (status === "deleted") return `Deleted, not ${done} yet`;
  return `Draft, not ${done} yet`;
}

function storageWord(workspace: WorkspaceDto | null): string {
  if (workspace?.storage === "database") return "The site's database";
  if (workspace?.storage === "github")
    return workspace.repository ? `GitHub, ${workspace.repository}` : "GitHub";
  return "Files on this computer";
}

export function Inspector({
  path,
  slug,
  status,
  version,
  fields,
  workspace,
  action,
  canRestore,
  onRestore,
  onClose,
}: {
  path: string;
  slug: string;
  status: EntryStatus;
  version: string | null;
  fields: readonly SchemaFieldDto[];
  workspace: WorkspaceDto | null;
  action: DraftsDto["publish"] | undefined;
  canRestore: boolean;
  onRestore: (raw: string, from: VersionDto) => void;
  onClose: () => void;
}) {
  const changed = status !== "published";
  return (
    <aside className="inspector" aria-label="About this entry">
      <TabsPrimitive.Root defaultValue={changed ? "changes" : "details"} className="inspector-tabs">
        <header className="pane-head inspector-head">
          <TabsPrimitive.List className="inspector-tablist">
            <TabsPrimitive.Tab value="details" className="inspector-tab">
              Details
            </TabsPrimitive.Tab>
            <TabsPrimitive.Tab value="changes" className="inspector-tab">
              Changes
            </TabsPrimitive.Tab>
            <TabsPrimitive.Tab value="history" className="inspector-tab">
              History
            </TabsPrimitive.Tab>
          </TabsPrimitive.List>
          <button
            type="button"
            className="icon-btn inspector-close"
            aria-label="Hide the panel"
            title={`Hide the panel (${shortcut("\\")})`}
            onClick={onClose}
          >
            <IconClose />
          </button>
        </header>
        <TabsPrimitive.Panel value="details" className="inspector-body">
          <dl className="inspector-facts">
            <div>
              <dt>Status</dt>
              <dd>{statusWord(status, action)}</dd>
            </div>
            <div>
              <dt>Saved in</dt>
              <dd>{storageWord(workspace)}</dd>
            </div>
            <div>
              <dt>URL name</dt>
              <dd className="inspector-slug">{slug}</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd className="inspector-path">{path}</dd>
            </div>
          </dl>
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="changes" className="inspector-body">
          {changed ? (
            // Keyed by version: every save is a new comparison.
            <DiffView key={version ?? "new"} path={path} fields={fields} />
          ) : (
            <p className="inspector-empty">No changes. This is the {doneWord(action)} version.</p>
          )}
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="history" className="inspector-body">
          <HistoryPanel
            path={path}
            version={version}
            fields={fields}
            canRestore={canRestore}
            onRestore={onRestore}
          />
        </TabsPrimitive.Panel>
      </TabsPrimitive.Root>
    </aside>
  );
}
