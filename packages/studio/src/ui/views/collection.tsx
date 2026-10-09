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
import type { EntryList, EntryStatus, EntrySummary } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { AssetThumb, formatCell } from "../components/fields";
import { IconCaretDown, IconClose, IconSearch, IconSort, IconWarning } from "../components/icons";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../components/ui/menu";
import { api, plainError, qs } from "../lib/api";
import { humanise, labelOf, titleField } from "../lib/fields";
import { relativeTime } from "../lib/format";
import { collectionLabel, publishVerb, singular, useStudio } from "../lib/studio";

const STATUS_TEXT: Record<EntryStatus, string> = {
  published: "Published",
  changed: "Changed",
  new: "New",
  deleted: "Deleted",
};

export function StatusLabel({ status, conflict }: { status: EntryStatus; conflict?: boolean }) {
  if (conflict) {
    return (
      <span
        className="status"
        data-status="conflict"
        title="Published again by someone else since you started editing"
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
        ? "Published"
        : status === "new"
          ? "Not published yet"
          : status === "changed"
            ? "Unpublished changes"
            : "Deletion not published"}
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

export function CollectionView({ collection }: { collection: string }) {
  const { schema, workspace, drafts, navigate, openCreate } = useStudio();
  const meta = schema.data?.collections.find((c) => c.name === collection);
  const fields = useMemo(() => meta?.fields ?? [], [meta]);
  const columns = useMemo(() => columnsFor(fields), [fields]);
  const hasImages = fields.some(
    (f) => f.type === "asset" || (f.type === "array" && f.items?.type === "asset"),
  );
  const canWrite = workspace.data?.canWrite ?? true;
  const local = workspace.data?.storage === "local";

  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [where, setWhere] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "site",
    dir: "asc",
  });
  const [list, setList] = useState<EntryList | null>(null);
  const [items, setItems] = useState<EntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Reset when the collection changes.
  useEffect(() => {
    setQ("");
    setQuery("");
    setStatus("all");
    setWhere({});
    setSort({ key: "site", dir: "asc" });
    setSelected(new Set());
  }, [collection]);

  // Debounced search: the server answers fast, but not every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 180);
    return () => clearTimeout(timer);
  }, [q]);

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

  const seq = useRef(0);
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const page = await api<EntryList>(`/entries${qs({ ...params, cursor, limit: 100 })}`);
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

  // Refresh the visible page when drafts change (a save elsewhere, a publish).
  const draftStamp = drafts.data?.changes.length;
  useEffect(() => {
    if (draftStamp !== undefined) void fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStamp]);

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
    if (
      kind === "delete" &&
      !window.confirm(`Delete ${noun}? Published entries stay live until you publish the deletion.`)
    )
      return;
    if (kind === "discard" && !window.confirm(`Discard unpublished changes to ${noun}?`)) return;
    setBusy(true);
    try {
      if (kind === "publish") {
        const paths = chosen.filter((item) => item.status !== "published").map((item) => item.path);
        if (paths.length === 0) {
          toast("Nothing to publish", {
            description: "The selected entries have no unpublished changes.",
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
          description: "Publish the deletion to remove it from the site.",
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
          <button
            type="button"
            className="btn"
            data-variant="primary"
            onClick={() => openCreate(collection)}
          >
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
              <IconClose size={12} />
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
              {value === "all" ? "All" : value === "unpublished" ? "Unpublished" : "Published"}
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
                <IconCaretDown size={11} />
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{field ? labelOf(field) : humanise(facet.field)}</MenuLabel>
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
              </MenuContent>
            </Menu>
          );
        })}

        <span className="toolbar-spacer" />

        <Menu>
          <MenuTrigger className="filter">
            <IconSort size={13} />
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
            <MenuLabel>Sort by</MenuLabel>
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
            onClick={() =>
              void fetchPage(items.length > 0 ? (list?.nextCursor ?? undefined) : undefined)
            }
          >
            Try again
          </button>
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="entries" aria-busy={loading}>
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
              <th className="col-title">Name</th>
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
                        title={
                          item.conflict
                            ? "Needs a decision before publishing"
                            : STATUS_TEXT[item.status]
                        }
                      >
                        {item.conflict ? "Conflict" : STATUS_TEXT[item.status]}
                      </span>
                    ) : null}
                    {item.problem ? (
                      <span className="row-problem" title={item.problem}>
                        <IconWarning size={12} /> Can't be read
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
                <p className="listing-empty-title">Nothing matches.</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQ("");
                    setStatus("all");
                    setWhere({});
                  }}
                >
                  Clear filters
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
            disabled={busy || !canWrite}
            onClick={() => void bulk("publish")}
          >
            {publishVerb(drafts.data?.publish)}
          </button>
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
