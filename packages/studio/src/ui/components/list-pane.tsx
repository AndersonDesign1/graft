/**
 * The list beside an open entry: the collection's entries, the open one
 * marked, so moving to the next entry is one click and the place is never
 * lost. The full table, with columns, filters and bulk actions, is still the
 * collection view; this is its narrow companion.
 *
 * The arrow keys move between entries and Enter opens one. Moving never opens
 * on its own: the entry that's open may have an edit still saving.
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { EntryList, EntryStatus } from "../../editor-types";
import { qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { moveRowFocus } from "../lib/row-focus";
import { collectionLabel, singular, useStudio } from "../lib/studio";
import { useResource } from "../lib/use-resource";
import { IconPlus } from "./icons";
import { Tooltip } from "./ui/tooltip";

const STATE_WORD = {
  changed: "Draft",
  new: "New draft",
  deleted: "Deleted",
} satisfies Partial<Record<EntryStatus, string>>;

/** Move focus to the next or previous row link in the list. */
function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  if (moveRowFocus(event.currentTarget, "a.pane-row", event)) event.preventDefault();
}

export function ListPane({ collection, selected }: { collection: string; selected: string }) {
  const { drafts, openCreate, workspace } = useStudio();
  // Saves and publishes refresh the drafts list; the states here follow it.
  const list = useResource<EntryList>(`/entries${qs({ collection, limit: 200 })}`, [drafts.data]);
  const current = useRef<HTMLAnchorElement | null>(null);

  // Keep the open entry in view when the list is long.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [selected, list.data]);

  const items = list.data?.items ?? [];
  return (
    <section className="list-pane" aria-label={collectionLabel(collection)}>
      <header className="pane-head">
        <a className="pane-title" href={`#/c/${encodeURIComponent(collection)}`}>
          {collectionLabel(collection)}
        </a>
        {list.data ? (
          <span className="pane-sub" data-numeric="">
            {list.data.counts.all}
          </span>
        ) : null}
        <span className="pane-head-end">
          <Tooltip label={`New ${singular(collection)}`}>
            <button
              type="button"
              className="icon-btn"
              aria-label={`New ${singular(collection)}`}
              disabled={workspace.data ? !workspace.data.canWrite : false}
              onClick={() => openCreate(collection)}
            >
              <IconPlus />
            </button>
          </Tooltip>
        </span>
      </header>
      <nav
        className="pane-rows"
        aria-label={`${collectionLabel(collection)} entries`}
        onKeyDown={moveFocus}
      >
        {list.error ? <p className="pane-note">{list.error}</p> : null}
        {items.map((item) => {
          const open = item.slug === selected;
          return (
            <a
              key={item.path}
              ref={open ? current : undefined}
              className="pane-row"
              href={`#/c/${encodeURIComponent(collection)}/${encodeURIComponent(item.slug)}`}
              aria-current={open ? "page" : undefined}
            >
              <span className="pane-row-title">{item.title || item.slug}</span>
              <span className="pane-row-meta">
                {item.status !== "published" ? (
                  <span className="status" data-status={item.status}>
                    <span className="status-dot" />
                    {STATE_WORD[item.status]}
                  </span>
                ) : (
                  <span className="pane-row-slug">{item.slug}</span>
                )}
                {item.updatedAt ? (
                  <span className="pane-row-when">{relativeTime(item.updatedAt)}</span>
                ) : null}
              </span>
            </a>
          );
        })}
        {list.data && list.data.total > items.length ? (
          <a className="pane-note" href={`#/c/${encodeURIComponent(collection)}`}>
            {list.data.total - items.length} more in the full list
          </a>
        ) : null}
      </nav>
    </section>
  );
}
