/**
 * A collection as a table: find, filter, sort and act on many entries.
 *
 * Built for a catalog of thousands. The server searches, filters, sorts and
 * pages (`/entries`); this view asks for a page at a time and appends the next
 * as the end of the table scrolls into view. Rows use `content-visibility`, so
 * a long table costs layout only for what is on screen. Rows do not animate:
 * a list is scanned many times an hour, and motion there is noise.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DraftsDto, EntryList, EntryStatus, EntrySummary } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { AssetThumb, formatCell } from "../components/fields";
import { SetFieldDialog } from "../components/set-field-dialog";
import {
  IconCaretDown,
  IconClose,
  IconPlus,
  IconSearch,
  IconSort,
  IconWarning,
} from "../components/icons";
import { useConfirm } from "../components/ui/confirm";
import { Menu, MenuContent, MenuItem, MenuSection, MenuTrigger } from "../components/ui/menu";
import { api, plainError, qs } from "../lib/api";
import { humanise, labelOf, settableFields, titleField } from "../lib/fields";
import { relativeTime } from "../lib/format";
import { isTyping, moveRowFocus } from "../lib/row-focus";
import { listStateFromHash, replaceListState } from "../lib/route";
import {
  actionWord,
  collectionLabel,
  deletionNote,
  doneWord,
  PUBLISH_NEEDS_EDITOR,
  publishVerb,
  singular,
  useCanPublish,
  useStudio,
} from "../lib/studio";

/** How a row names its state. A published entry is the resting state: nothing. */
const STATUS_TEXT: Record<EntryStatus, string> = {
  published: "",
  changed: "Draft",
  new: "New draft",
  deleted: "Deleted",
};

/**
 * The entry's state, as a mark and a word. The word follows what the
 * workspace's action is called: "Committed" on a laptop, "Published" when
 * Studio publishes.
 */
export function StatusLabel({
  status,
  conflict,
  action,
}: {
  status: EntryStatus;
  conflict?: boolean;
  action?: DraftsDto["publish"];
}) {
  const done = doneWord(action);
  if (conflict) {
    return (
      <span
        className="status"
        data-status="conflict"
        title={`Someone else ${done} this entry after you started editing`}
      >
        <span className="status-dot" />
        Needs a decision
      </span>
    );
  }
  return (
    <span className="status" data-status={status}>
      <span className="status-dot" />
      {status === "published"
        ? done.charAt(0).toUpperCase() + done.slice(1)
        : status === "new"
          ? "New draft"
          : status === "changed"
            ? "Draft"
            : `Deleted, not ${done} yet`}
    </span>
  );
}

/** Columns worth a glance in a list: the first few short, scalar fields. */
function columnsFor(fields: readonly SchemaFieldDto[]): SchemaFieldDto[] {
  const headline = titleField(fields);
  const priority = (field: SchemaFieldDto): number => {
    if (field.format === "money") return 0;
    if (field.type === "select") return 1;
    if (field.type === "reference") return 2;
    if (field.type === "number") return 3;
    if (field.type === "boolean") return 4;
    if (field.type === "datetime") return 5;
    if (field.type === "string" && (field.constraints?.maxLength ?? 999) <= 80) return 6;
    return 99;
  };
  return fields
    .filter((field) => field !== headline && priority(field) < 99)
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, 4);
}

type StatusFilter = "all" | "unpublished" | "published";

/** Rows per request, and the most a refresh asks for at once (the API's cap). */
const PAGE = 100;
const MAX_PAGE = 500;

export function CollectionView({ collection }: { collection: string }) {
  const { schema, workspace, drafts, publish, navigate, openCreate } = useStudio();
  const confirm = useConfirm();
  const meta = schema.data?.collections.find((c) => c.name === collection);
  const fields = useMemo(() => meta?.fields ?? [], [meta]);
  const columns = useMemo(() => columnsFor(fields), [fields]);
  const hasImages = fields.some(
    (f) => f.type === "asset" || (f.type === "array" && f.items?.type === "asset"),
  );
  const canWrite = workspace.data?.canWrite ?? true;
  const canPublish = useCanPublish();
  const local = workspace.data?.storage === "local";

  // Search, filters and sort start from the address, so a reload or a shared
  // link shows the same rows. The view is keyed by collection, so another
  // collection starts from its own address, not this one's state.
  const [initial] = useState(() => listStateFromHash(window.location.hash));
  const [q, setQ] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  const [status, setStatus] = useState<StatusFilter>(initial.status);
  const [where, setWhere] = useState<Record<string, string>>(initial.where);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>(initial.sort);
  const [list, setList] = useState<EntryList | null>(null);
  const [items, setItems] = useState<EntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [settingField, setSettingField] = useState(false);

  // Debounced search: the server answers fast, but not every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 180);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    replaceListState({ q: query, status, where, sort });
  }, [query, status, where, sort]);

  // The address changed under the list (its link in the sidebar, or an edit
  // to the URL): show what it now says, so the two never disagree.
  useEffect(() => {
    const onHash = (): void => {
      const next = listStateFromHash(window.location.hash);
      setQ(next.q);
      setQuery(next.q);
      setStatus(next.status);
      setWhere(next.where);
      setSort(next.sort);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const params = useMemo(
    () => ({
      collection,
      q: query,
      status: status === "all" ? undefined : status,
      sort: sort.key,
      dir: sort.dir,
      ...Object.fromEntries(Object.entries(where).map(([k, v]) => [`where.${k}`, v])),
    }),
    [collection, query, status, sort, where],
  );

  // j and k move through the rows from anywhere on the page; the arrows,
  // Home and End once focus is in the table.
  const table = useRef<HTMLTableElement | null>(null);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "j" && event.key !== "k") return;
      if (!table.current || table.current.contains(document.activeElement)) return;
      if (isTyping(event.target)) return;
      if (moveRowFocus(table.current, "a.row-title", event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const seq = useRef(0);
  // The page the last request asked for, so Try again repeats that request:
  // a failed first page must not be retried from the old list's cursor.
  const lastCursor = useRef<string | undefined>(undefined);
  const fetchPage = useCallback(
    async (cursor?: string, size = PAGE) => {
      const mine = ++seq.current;
      lastCursor.current = cursor;
      setLoading(true);
      try {
        const page = await api<EntryList>(`/entries${qs({ ...params, cursor, limit: size })}`);
        if (mine !== seq.current) return;
        setError(null);
        setList(page);
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      } catch (err) {
        if (mine === seq.current) setError(plainError(err));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  // Refresh the visible page whenever drafts are refetched (a save, a publish,
  // a discard). Not keyed on the count: editing an entry that already has a
  // draft leaves the count alone but changes its row.
  // Everything already scrolled into view is fetched again in one request, so
  // a save doesn't drop the rows below the first page.
  const loaded = useRef(0);
  loaded.current = items.length;
  const draftsSeen = drafts.data;
  useEffect(() => {
    if (draftsSeen) void fetchPage(undefined, Math.min(MAX_PAGE, Math.max(PAGE, loaded.current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsSeen]);

  // A selection only means something for the rows it was made on.
  useEffect(() => setSelected(new Set()), [params]);

  // Next page when the end of the table is in view. Not after a failure: the
  // sentinel stays in view, so retrying here would loop; the notice offers it.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list?.nextCursor || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading && list.nextCursor)
        void fetchPage(list.nextCursor);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [list, loading, error, fetchPage]);

  const facetFields = useMemo(
    () => (list?.facets ?? []).filter((facet) => facet.values.length > 1),
    [list],
  );

  async function bulk(kind: "publish" | "discard" | "delete"): Promise<void> {
    const chosen = items.filter((item) => selected.has(item.path));
    if (chosen.length === 0) return;
    const noun =
      chosen.length === 1 ? (chosen[0]?.title ?? "1 entry") : `${chosen.length} ${collection}`;
    const what = chosen.length === 1 ? singular(collection) : `${chosen.length} entries`;
    if (kind === "delete") {
      const ok = await confirm({
        kind: "delete",
        title: `Delete ${chosen.length === 1 ? `“${noun}”` : noun}?`,
        body: deletionNote(drafts.data?.publish, true),
        action: `Delete ${what}`,
      });
      if (!ok) return;
    }
    if (kind === "discard") {
      const ok = await confirm({
        kind: "discard",
        title: `Discard your changes to ${chosen.length === 1 ? `“${noun}”` : noun}?`,
        body: `Your edits are thrown away. The ${doneWord(drafts.data?.publish)} versions stay as they are.`,
        action: "Discard changes",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      if (kind === "publish") {
        const paths = chosen.filter((item) => item.status !== "published").map((item) => item.path);
        if (paths.length === 0) {
          toast(`Nothing to ${actionWord(drafts.data?.publish)}`, {
            description: "The selected entries have no drafts.",
          });
        } else {
          await api("/drafts/publish", { method: "POST", body: JSON.stringify({ paths }) });
          toast.success(
            `${publishVerb(drafts.data?.publish)}: ${paths.length === 1 ? "1 entry" : `${paths.length} entries`}`,
          );
        }
      } else if (kind === "discard") {
        const paths = chosen.filter((item) => item.status !== "published").map((item) => item.path);
        await api("/drafts/discard", { method: "POST", body: JSON.stringify({ paths }) });
        toast.success("Changes discarded");
      } else {
        for (const item of chosen) {
          await api("/entry", {
            method: "DELETE",
            body: JSON.stringify({ collection, slug: item.slug }),
          });
        }
        toast.success(`Deleted ${noun}`, {
          description:
            drafts.data?.publish === "commit"
              ? "Commit the deletion to record it in Git."
              : drafts.data?.publish === "review"
                ? "Submit the deletion for review."
                : "Publish the deletion to remove it from the site.",
        });
      }
      setSelected(new Set());
      drafts.refresh();
      await fetchPage();
    } catch (err) {
      toast.error(plainError(err));
    } finally {
      setBusy(false);
    }
  }

  const label = collectionLabel(collection);
  const all = list?.counts.all ?? 0;
  const filtered = query !== "" || status !== "all" || Object.keys(where).length > 0;
  // The Drafts or Published tab alone: say what is empty, not that a search failed.
  const onlyStatus = query === "" && Object.keys(where).length === 0 && status !== "all";
  const allVisibleSelected = items.length > 0 && items.every((item) => selected.has(item.path));

  return (
    <div className="listing">
      <header className="listing-head">
        <div className="listing-titles">
          <h1 className="listing-title">{label}</h1>
          <p className="listing-sub">
            {meta?.description ?? `Every ${singular(collection)} in the site.`}
          </p>
        </div>
        {canWrite ? (
          <button type="button" className="btn" onClick={() => openCreate(collection)}>
            <IconPlus aria-hidden="true" />
            New {singular(collection)}
          </button>
        ) : null}
      </header>

      <div className="toolbar" role="toolbar" aria-label={`Filter ${label.toLowerCase()}`}>
        <label className="search">
          <IconSearch size={14} />
          <input
            value={q}
            placeholder={`Search ${all} ${all === 1 ? singular(collection) : collection}…`}
            onChange={(e) => setQ(e.target.value)}
            aria-label={`Search ${label.toLowerCase()}`}
          />
          {q ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => setQ("")}
            >
              <IconClose size={14} />
            </button>
          ) : null}
        </label>

        <div className="segments" role="radiogroup" aria-label="Status">
          {(["all", "unpublished", "published"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={status === value}
              className="segment"
              data-active={status === value || undefined}
              onClick={() => setStatus(value)}
            >
              {value === "all"
                ? "All"
                : value === "unpublished"
                  ? "Drafts"
                  : drafts.data?.publish === "commit"
                    ? "Committed"
                    : "Published"}
              {value === "unpublished" && list?.counts.unpublished ? (
                <span className="segment-count" data-numeric="">
                  {list.counts.unpublished}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {facetFields.map((facet) => {
          const field = fields.find((f) => f.name === facet.field);
          const active = where[facet.field];
          return (
            <Menu key={facet.field}>
              <MenuTrigger className="filter" data-active={active !== undefined || undefined}>
                {field ? labelOf(field) : humanise(facet.field)}
                {active !== undefined ? (
                  <b>
                    :{" "}
                    {formatCell(
                      field,
                      active === "true" ? true : active === "false" ? false : active,
                    )}
                  </b>
                ) : null}
                <IconCaretDown size={14} />
              </MenuTrigger>
              <MenuContent>
                <MenuSection label={field ? labelOf(field) : humanise(facet.field)}>
                  <MenuItem
                    onClick={() =>
                      setWhere((prev) => {
                        const next = { ...prev };
                        delete next[facet.field];
                        return next;
                      })
                    }
                  >
                    <span className="menu-item-label">Any</span>
                  </MenuItem>
                  {facet.values.map((value) => (
                    <MenuItem
                      key={value.value}
                      data-active={active === value.value || undefined}
                      onClick={() => setWhere((prev) => ({ ...prev, [facet.field]: value.value }))}
                    >
                      <span className="menu-item-label">
                        {formatCell(
                          field,
                          value.value === "true"
                            ? true
                            : value.value === "false"
                              ? false
                              : value.value,
                        )}
                      </span>
                      <span className="menu-item-hint" data-numeric="">
                        {value.count}
                      </span>
                    </MenuItem>
                  ))}
                </MenuSection>
              </MenuContent>
            </Menu>
          );
        })}

        <span className="toolbar-spacer" />

        <Menu>
          <MenuTrigger className="filter">
            <IconSort size={14} />
            {sort.key === "site"
              ? "Default order"
              : sort.key === "title"
                ? "Name"
                : sort.key === "updated"
                  ? "Last edited"
                  : labelOf(fields.find((f) => f.name === sort.key) ?? { name: sort.key })}
            {sort.key !== "site" ? (sort.dir === "asc" ? " ↑" : " ↓") : null}
          </MenuTrigger>
          <MenuContent align="end">
            <MenuSection label="Sort by">
              {[
                { key: "site", label: "Default order" },
                { key: "title", label: "Name" },
                ...(local ? [{ key: "updated", label: "Last edited" }] : []),
                ...columns.map((field) => ({ key: field.name, label: labelOf(field) })),
              ].map((option) => (
                <MenuItem
                  key={option.key}
                  data-active={sort.key === option.key || undefined}
                  onClick={() =>
                    setSort((prev) => ({
                      key: option.key,
                      dir:
                        prev.key === option.key && prev.dir === "asc" && option.key !== "site"
                          ? "desc"
                          : "asc",
                    }))
                  }
                >
                  <span className="menu-item-label">{option.label}</span>
                  {sort.key === option.key && option.key !== "site" ? (
                    <span className="menu-item-hint">{sort.dir === "asc" ? "↑" : "↓"}</span>
                  ) : null}
                </MenuItem>
              ))}
            </MenuSection>
          </MenuContent>
        </Menu>
      </div>

      {error ? (
        <p className="notice" data-tone="error">
          <IconWarning size={14} />
          <span>{error}</span>
          <button
            type="button"
            className="btn notice-action"
            onClick={() => void fetchPage(lastCursor.current)}
          >
            Try again
          </button>
        </p>
      ) : null}

      <div className="table-wrap">
        <table
          ref={table}
          className="entries"
          aria-busy={loading}
          onKeyDown={(event) => {
            if (moveRowFocus(event.currentTarget, "a.row-title", event)) event.preventDefault();
          }}
        >
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allVisibleSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(items.map((i) => i.path)) : new Set())
                  }
                />
              </th>
              <th className="col-title">Title</th>
              {columns.map((field) => (
                <th key={field.name} data-align={field.type === "number" ? "end" : undefined}>
                  {labelOf(field)}
                </th>
              ))}
              {local ? <th className="col-updated">Edited</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.path}
                data-selected={selected.has(item.path) || undefined}
                data-status={item.status}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("input,button,a")) return;
                  navigate({ view: "entry", collection, slug: item.slug });
                }}
              >
                <td className="col-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={selected.has(item.path)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.path)) next.delete(item.path);
                        else next.add(item.path);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="col-title">
                  <a
                    className="row-title"
                    href={`#/c/${encodeURIComponent(collection)}/${encodeURIComponent(item.slug)}`}
                  >
                    {hasImages ? <AssetThumb assetKey={item.image} size="sm" /> : null}
                    <span className="row-name">{item.title}</span>
                    {item.status !== "published" || item.conflict ? (
                      <span
                        className="row-state"
                        data-status={item.conflict ? "conflict" : item.status}
                      >
                        {item.conflict ? "Needs a decision" : STATUS_TEXT[item.status]}
                      </span>
                    ) : null}
                    {item.problem ? (
                      <span className="row-problem" title={item.problem}>
                        <IconWarning size={14} /> Can't be read
                      </span>
                    ) : null}
                  </a>
                </td>
                {columns.map((field) => {
                  const value = item.fields[field.name];
                  return (
                    <td
                      key={field.name}
                      data-align={field.type === "number" ? "end" : undefined}
                      data-numeric={field.type === "number" ? "" : undefined}
                    >
                      {field.type === "select" && value ? (
                        <span className="chip" data-value={String(value)}>
                          {formatCell(field, value)}
                        </span>
                      ) : (
                        formatCell(field, value)
                      )}
                    </td>
                  );
                })}
                {local ? (
                  <td className="col-updated">
                    <time dateTime={item.updatedAt}>{relativeTime(item.updatedAt)}</time>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && items.length === 0 ? (
          <div className="listing-empty">
            {filtered ? (
              <>
                <p className="listing-empty-title">
                  {onlyStatus
                    ? status === "unpublished"
                      ? `No drafts. Every ${singular(collection)} is ${doneWord(drafts.data?.publish)}.`
                      : `Nothing ${doneWord(drafts.data?.publish)} yet.`
                    : "Nothing matches."}
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQ("");
                    setStatus("all");
                    setWhere({});
                  }}
                >
                  {onlyStatus ? "Show all" : "Clear filters"}
                </button>
              </>
            ) : (
              <>
                <p className="listing-empty-title">No {collection} yet.</p>
                {canWrite ? (
                  <button
                    type="button"
                    className="btn"
                    data-variant="primary"
                    onClick={() => openCreate(collection)}
                  >
                    Create the first {singular(collection)}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <div ref={sentinel} className="listing-sentinel" aria-hidden="true" />
        {list ? (
          <p className="listing-count" data-numeric="">
            {filtered
              ? `${list.total} of ${all}`
              : `${all} ${all === 1 ? singular(collection) : collection}`}
          </p>
        ) : null}
      </div>

      <SetFieldDialog
        collection={collection}
        entries={items.filter((item) => selected.has(item.path))}
        fields={fields}
        open={settingField}
        onOpenChange={setSettingField}
        onSaved={(failed) => {
          // What wasn't saved stays selected, to fix and try again.
          const keep = new Set(failed);
          setSelected(new Set(items.filter((i) => keep.has(i.slug)).map((i) => i.path)));
          drafts.refresh();
        }}
      />

      {selected.size > 0 ? (
        <div className="bulk" role="toolbar" aria-label="Selected entries">
          <span className="bulk-count" data-numeric="">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="btn"
            data-size="sm"
            data-variant="primary"
            disabled={busy || !canWrite || !canPublish}
            onClick={() => void bulk("publish")}
            title={canPublish ? undefined : PUBLISH_NEEDS_EDITOR}
          >
            {publishVerb(publish)}
          </button>
          {settableFields(fields).length > 0 ? (
            <button
              type="button"
              className="btn"
              data-size="sm"
              disabled={busy || !canWrite}
              onClick={() => setSettingField(true)}
            >
              Set a field
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            data-size="sm"
            disabled={busy || !canWrite}
            onClick={() => void bulk("discard")}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="btn"
            data-size="sm"
            data-variant="ghost"
            disabled={busy || !canWrite}
            onClick={() => void bulk("delete")}
          >
            Delete
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <IconClose size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
