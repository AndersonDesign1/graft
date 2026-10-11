/**
 * The form an editor fills in, built from the collection's schema.
 *
 * Every control is chosen from the declared field type (lib/fields.ts), every
 * label from the field's `label` or its humanised key, and every limit the
 * validator enforces is shown before it bites. Nested values (a product's
 * variants, its SEO group, its gallery) are edited in place: the old form's
 * "Edit in Raw MDX" was a dead end for exactly the people Studio is for.
 *
 * Nothing here serialises. Controls hand whole values up; the entry view
 * composes the frontmatter and the server writes it with composeDocument, so
 * keys an item carries that the schema does not know survive every edit
 * (items are spread, never rebuilt).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { EntryList } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { api, qs } from "../lib/api";
import { controlOf, emptyValue, formatMoney, labelOf, moneyInput, parseMoney } from "../lib/fields";
import { humanise } from "../lib/fields";
import { singular } from "../lib/studio";
import { IconCaretDown, IconCheck, IconClose, IconFile, IconSearch, IconWarning } from "./icons";
import { NumberField, Switch } from "./ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export interface ControlProps {
  field: SchemaFieldDto;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Dotted path of this value, the key problems are reported under. */
  path: string;
  problems: ReadonlyMap<string, string>;
  disabled?: boolean;
  /** Set on an input that should take focus when the form opens. */
  autoFocus?: boolean;
}

/** Short controls sit two to a row; long ones take the whole width. */
const COMPACT = new Set(["number", "money", "toggle", "select", "reference", "datetime"]);

/* ---- a labelled field ---------------------------------------------------- */

export function FieldRow(props: ControlProps) {
  const { field, path, problems } = props;
  const id = useId();
  const control = controlOf(field);
  const problem = problems.get(path);
  const describedBy = [field.description ? `${id}-help` : "", problem ? `${id}-problem` : ""]
    .filter(Boolean)
    .join(" ");
  const grouped = control === "group" || control === "list" || control === "gallery";
  // Short text (a SKU, a colour) sits beside its neighbour like a number does.
  const compact =
    COMPACT.has(control) ||
    (control === "text" &&
      field.constraints?.maxLength !== undefined &&
      field.constraints.maxLength <= 60);

  const body = (
    <>
      <div className="fr-head">
        {grouped ? (
          <span className="fr-label" id={`${id}-label`}>
            {labelOf(field)}
          </span>
        ) : (
          <label className="fr-label" htmlFor={id}>
            {labelOf(field)}
          </label>
        )}
        {field.optional ? <span className="fr-optional">Optional</span> : null}
        <Limit field={field} value={props.value} />
      </div>
      <Control {...props} inputId={id} describedBy={describedBy || undefined} />
      {field.description ? (
        <p className="fr-help" id={`${id}-help`}>
          {field.description}
        </p>
      ) : null}
      {problem ? (
        <p className="fr-problem" id={`${id}-problem`} role="alert">
          <IconWarning size={13} />
          <span>{problem}</span>
        </p>
      ) : null}
    </>
  );

  return (
    <div
      className="fr"
      data-control={control}
      data-wide={!compact || undefined}
      data-invalid={problem ? "" : undefined}
      role={grouped ? "group" : undefined}
      aria-labelledby={grouped ? `${id}-label` : undefined}
    >
      {body}
    </div>
  );
}

/** "62 / 80", once a limited text is getting close, so the limit is never a surprise. */
function Limit({ field, value }: { field: SchemaFieldDto; value: unknown }) {
  const max = field.constraints?.maxLength;
  if (!max || typeof value !== "string" || value.length < max * 0.7) return null;
  return (
    <span className="fr-limit" data-over={value.length > max || undefined} data-numeric="">
      {value.length} / {max}
    </span>
  );
}

/* ---- dispatch ------------------------------------------------------------ */

function Control(props: ControlProps & { inputId: string; describedBy?: string }) {
  switch (controlOf(props.field)) {
    case "text":
      return <TextControl {...props} />;
    case "textarea":
      return <TextareaControl {...props} />;
    case "number":
      return (
        <NumberField
          id={props.inputId}
          value={typeof props.value === "number" ? props.value : null}
          onValueChange={(next) => props.onChange(next ?? "")}
          disabled={props.disabled}
          {...(props.field.constraints?.min !== undefined
            ? { min: props.field.constraints.min }
            : {})}
          {...(props.field.constraints?.max !== undefined
            ? { max: props.field.constraints.max }
            : {})}
        />
      );
    case "money":
      return <MoneyControl {...props} />;
    case "toggle":
      return (
        <div className="fc-toggle">
          <Switch
            id={props.inputId}
            checked={props.value === true}
            onCheckedChange={(next) => props.onChange(next)}
            disabled={props.disabled}
          />
          <span className="fc-toggle-state">{props.value === true ? "On" : "Off"}</span>
        </div>
      );
    case "datetime":
      return <DateTimeControl {...props} />;
    case "select":
      return <SelectControl {...props} />;
    case "reference":
      return <ReferenceControl {...props} />;
    case "asset":
      return <AssetControl {...props} />;
    case "group":
      return <GroupControl {...props} />;
    case "list":
      return <ListControl {...props} />;
    case "tags":
      return <TagsControl {...props} />;
    case "gallery":
      return <GalleryControl {...props} />;
    case "references":
      return <ReferencesControl {...props} />;
    default:
      return <JsonControl {...props} />;
  }
}

type InputProps = ControlProps & { inputId: string; describedBy?: string };

function TextControl({
  field,
  value,
  onChange,
  disabled,
  inputId,
  describedBy,
  problems,
  path,
  autoFocus,
}: InputProps) {
  return (
    <input
      id={inputId}
      className="input"
      value={
        typeof value === "string"
          ? value
          : value === undefined || value === null
            ? ""
            : String(value)
      }
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={problems.has(path) || undefined}
      spellCheck={field.name !== "sku"}
      autoFocus={autoFocus}
    />
  );
}

/** Grows with its content, so a long summary never hides behind a scroll bar. */
function TextareaControl({
  value,
  onChange,
  disabled,
  inputId,
  describedBy,
  problems,
  path,
}: InputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = typeof value === "string" ? value : "";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      id={inputId}
      className="input textarea fc-textarea"
      rows={2}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={problems.has(path) || undefined}
    />
  );
}

/**
 * An amount, typed the way people type amounts ("12.50", "$1,299") and
 * stored the way code multiplies them (1250 cents). The box keeps exactly
 * what was typed while it has focus, so a half-typed "12." is not rewritten
 * under the cursor.
 */
function MoneyControl({
  field,
  value,
  onChange,
  disabled,
  inputId,
  describedBy,
  problems,
  path,
}: InputProps) {
  const currency = field.constraints?.currency ?? "USD";
  const [draft, setDraft] = useState<string | null>(null);
  const symbol = useMemo(() => {
    try {
      return (
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
          currencyDisplay: "narrowSymbol",
        })
          .formatToParts(0)
          .find((part) => part.type === "currency")?.value ?? currency
      );
    } catch {
      return currency;
    }
  }, [currency]);
  const shown =
    draft ??
    (typeof value === "number"
      ? moneyInput(value, currency)
      : typeof value === "string"
        ? value
        : "");
  return (
    <div className="fc-money" data-invalid={problems.has(path) || undefined}>
      <span className="fc-money-symbol" aria-hidden="true">
        {symbol}
      </span>
      <input
        id={inputId}
        className="input fc-money-input"
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={problems.has(path) || undefined}
        onFocus={() => setDraft(shown)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim() === "") return onChange("");
          const minor = parseMoney(e.target.value, currency);
          onChange(minor ?? e.target.value);
        }}
      />
      <span className="fc-money-code" aria-hidden="true">
        {currency}
      </span>
    </div>
  );
}

/**
 * A date and a time, in UTC, written as the ISO string the validator wants.
 * `datetime-local` alone would drop the zone and quietly rewrite the author's
 * value; splitting into date and time keeps the zone explicit (and shown).
 * An offset this control cannot represent is edited as text instead.
 */
function DateTimeControl({ value, onChange, disabled, inputId, describedBy }: InputProps) {
  const text = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : "";
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(text);
  if (text && !match) {
    return (
      <input
        id={inputId}
        className="input"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={describedBy}
        spellCheck={false}
      />
    );
  }
  const [date, time] = match ? [match[1] as string, match[2] as string] : ["", ""];
  const compose = (d: string, t: string) => (d ? `${d}T${t || "00:00"}:00Z` : "");
  return (
    <div className="fc-datetime">
      <input
        id={inputId}
        type="date"
        className="input"
        value={date}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(compose(e.target.value, time))}
      />
      <input
        type="time"
        className="input"
        value={time}
        disabled={disabled || !date}
        aria-label="Time"
        onChange={(e) => onChange(compose(date, e.target.value))}
      />
      <span className="fc-zone">UTC</span>
    </div>
  );
}

/**
 * A choice. Up to four options show as a segmented control, so every option is
 * visible and one click away; more fall back to a native select, which is the
 * most accessible long list there is.
 */
function SelectControl({ field, value, onChange, disabled, inputId, describedBy }: InputProps) {
  const options = field.options ?? [];
  const current = typeof value === "string" ? value : "";
  if (options.length > 0 && options.length <= 4) {
    return (
      <div className="fc-segments" role="radiogroup" id={inputId} aria-describedby={describedBy}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={current === option.value}
            className="fc-segment"
            data-active={current === option.value || undefined}
            disabled={disabled}
            onClick={() => onChange(field.optional && current === option.value ? "" : option.value)}
          >
            {optionText(option)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="fc-select">
      <select
        id={inputId}
        className="input"
        value={current}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.optional || !current ? <option value="">Choose…</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionText(option)}
          </option>
        ))}
      </select>
      <IconCaretDown size={12} className="fc-select-caret" aria-hidden="true" />
    </div>
  );
}

/* ---- references ---------------------------------------------------------- */

/** Titles of referenced entries, shared across every picker on the page. */
const titleCache = new Map<string, string>();

function useEntryTitle(collection: string | undefined, slug: string): string | null {
  const key = `${collection}/${slug}`;
  const [title, setTitle] = useState<string | null>(titleCache.get(key) ?? null);
  useEffect(() => {
    if (!collection || !slug) return;
    const known = titleCache.get(key);
    if (known) {
      setTitle(known);
      return;
    }
    let cancelled = false;
    api<EntryList>(`/entries${qs({ collection, q: slug.replace(/-/g, " "), limit: 25 })}`)
      .then((list) => {
        const hit = list.items.find((item) => item.slug === slug);
        if (hit) titleCache.set(key, hit.title);
        if (!cancelled) setTitle(hit?.title ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [collection, slug, key]);
  return title;
}

/**
 * Search another collection and pick one entry. The value stays the bare
 * slug (readable in the file); the picker shows the entry's title.
 */
function EntryPicker({
  collection,
  exclude,
  onPick,
  trigger,
  disabled,
}: {
  collection: string;
  exclude?: readonly string[];
  onPick: (slug: string, title: string) => void;
  trigger: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<EntryList["items"]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api<EntryList>(`/entries${qs({ collection, q: query, limit: 20, sort: "title" })}`)
        .then((list) => {
          if (cancelled) return;
          for (const item of list.items) titleCache.set(`${collection}/${item.slug}`, item.title);
          setItems(list.items);
        })
        .catch(() => !cancelled && setItems([]))
        .finally(() => !cancelled && setLoading(false));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, collection]);

  const shown = items.filter((item) => !exclude?.includes(item.slug));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="fc-ref-trigger" disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="fc-ref-pop">
        <div className="fc-ref-search">
          <IconSearch size={14} />
          <input
            autoFocus
            className="fc-ref-input"
            placeholder={`Search ${humanise(collection).toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`Search ${collection}`}
          />
        </div>
        <ul className="fc-ref-list" role="listbox" aria-busy={loading}>
          {shown.length === 0 && !loading ? (
            <li className="fc-ref-empty">Nothing matches.</li>
          ) : null}
          {shown.map((item) => (
            <li key={item.slug}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="fc-ref-option"
                onClick={() => {
                  onPick(item.slug, item.title);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="fc-ref-title">{item.title}</span>
                <span className="fc-ref-slug">{item.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ReferenceControl(props: InputProps) {
  const { field, value, onChange, disabled } = props;
  const slug = typeof value === "string" ? value : "";
  const title = useEntryTitle(field.to, slug);
  if (!field.to) return <TextControl {...props} />;
  return (
    <div className="fc-ref">
      <EntryPicker
        collection={field.to}
        disabled={disabled}
        onPick={(picked) => onChange(picked)}
        trigger={
          slug ? (
            <span className="fc-ref-chosen">
              <span className="fc-ref-title">{title ?? humanise(slug)}</span>
              <IconCaretDown size={12} />
            </span>
          ) : (
            <span className="fc-ref-placeholder">
              Choose a {singular(field.to)}…
              <IconCaretDown size={12} />
            </span>
          )
        }
      />
      {slug && field.optional ? (
        <button type="button" className="fc-clear" aria-label="Clear" onClick={() => onChange("")}>
          <IconClose size={12} />
        </button>
      ) : null}
    </div>
  );
}

function ReferencesControl({ field, value, onChange, disabled }: InputProps) {
  const list = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const to = field.items?.to;
  if (!to) return <JsonControl {...({ field, value, onChange, disabled } as InputProps)} />;
  return (
    <div className="fc-chips">
      {list.map((slug, i) => (
        <RefChip
          key={`${slug}-${i}`}
          collection={to}
          slug={slug}
          disabled={disabled}
          onRemove={() => onChange(list.filter((_, j) => j !== i))}
        />
      ))}
      <EntryPicker
        collection={to}
        exclude={list}
        disabled={disabled}
        onPick={(slug) => onChange([...list, slug])}
        trigger={<span className="fc-chip-add">Add</span>}
      />
    </div>
  );
}

function RefChip({
  collection,
  slug,
  onRemove,
  disabled,
}: {
  collection: string;
  slug: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const title = useEntryTitle(collection, slug);
  return (
    <span className="fc-chip">
      {title ?? humanise(slug)}
      <button
        type="button"
        className="fc-chip-x"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${title ?? slug}`}
      >
        <IconClose size={11} />
      </button>
    </span>
  );
}

/* ---- tags ---------------------------------------------------------------- */

function TagsControl({ field, value, onChange, disabled, inputId }: InputProps) {
  const list = Array.isArray(value) ? (value as unknown[]).map(String) : [];
  const [text, setText] = useState("");
  const options = field.items?.options;

  // A list of choices is a set of toggles, not free text.
  if (options && options.length > 0) {
    return (
      <div className="fc-chips" role="group">
        {options.map((option) => {
          const on = list.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className="fc-chip fc-chip-toggle"
              data-active={on || undefined}
              aria-pressed={on}
              disabled={disabled}
              onClick={() =>
                onChange(on ? list.filter((v) => v !== option.value) : [...list, option.value])
              }
            >
              {on ? <IconCheck size={11} /> : null}
              {optionText(option)}
            </button>
          );
        })}
      </div>
    );
  }

  const add = (): void => {
    const next = text.trim();
    if (next && !list.includes(next)) onChange([...list, next]);
    setText("");
  };
  return (
    <div
      className="fc-chips fc-tags"
      onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
    >
      {list.map((tag, i) => (
        <span key={`${tag}-${i}`} className="fc-chip">
          {tag}
          <button
            type="button"
            className="fc-chip-x"
            disabled={disabled}
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(list.filter((_, j) => j !== i))}
          >
            <IconClose size={11} />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        className="fc-tags-input"
        value={text}
        disabled={disabled}
        placeholder={list.length === 0 ? "Type and press Enter" : ""}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && text === "" && list.length > 0) {
            onChange(list.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

/* ---- assets -------------------------------------------------------------- */

interface Asset {
  key: string;
  alt?: string;
}

const urlCache = new Map<string, string | null>();

export function useAssetUrl(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(key ? (urlCache.get(key) ?? null) : null);
  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    if (urlCache.has(key)) {
      setUrl(urlCache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ url: string | null }>(`/asset-url${qs({ key })}`)
        .then((res) => {
          urlCache.set(key, res.url);
          if (!cancelled) setUrl(res.url);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);
  return url;
}

function asAsset(value: unknown): Asset {
  if (value && typeof value === "object") {
    const record = value as { key?: unknown; alt?: unknown };
    return {
      ...(value as object),
      key: String(record.key ?? ""),
      ...(typeof record.alt === "string" ? { alt: record.alt } : {}),
    };
  }
  return { key: "" };
}

/** Spread the original so unknown keys survive; drop an emptied alt. */
function withAsset(original: unknown, patch: Partial<Asset>): Asset {
  const next = { ...asAsset(original), ...patch };
  if (!next.alt) delete next.alt;
  return next;
}

export function AssetThumb({
  assetKey,
  alt,
  size = "md",
}: {
  assetKey?: string;
  alt?: string;
  size?: "sm" | "md" | "lg";
}) {
  const url = useAssetUrl(assetKey);
  return (
    <span className="thumb" data-size={size}>
      {url ? (
        <img src={url} alt={alt ?? ""} loading="lazy" />
      ) : (
        <IconFile size={size === "sm" ? 12 : 16} />
      )}
    </span>
  );
}

function AssetControl({ value, onChange, disabled, inputId, describedBy }: InputProps) {
  const asset = asAsset(value);
  return (
    <div className="fc-asset">
      <AssetThumb assetKey={asset.key} alt={asset.alt} size="lg" />
      <div className="fc-asset-fields">
        <input
          id={inputId}
          className="input"
          value={asset.key}
          placeholder="products/hat/front.jpg"
          spellCheck={false}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-label="File"
          onChange={(e) => onChange(withAsset(value, { key: e.target.value }))}
        />
        <input
          className="input"
          value={asset.alt ?? ""}
          placeholder="Describe the image for people who can't see it"
          disabled={disabled}
          aria-label="Alt text"
          onChange={(e) => onChange(withAsset(value, { alt: e.target.value }))}
        />
      </div>
    </div>
  );
}

function GalleryControl({ value, onChange, disabled, path, problems }: InputProps) {
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  const update = (i: number, next: unknown) =>
    onChange(list.map((item, j) => (j === i ? next : item)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="fc-gallery">
      {list.map((item, i) => {
        const asset = asAsset(item);
        const problem = problems.get(`${path}.${i}`);
        return (
          <figure key={i} className="fc-tile" data-invalid={problem ? "" : undefined}>
            <AssetThumb assetKey={asset.key} alt={asset.alt} size="lg" />
            {i === 0 ? <span className="fc-tile-badge">Cover</span> : null}
            <input
              className="input fc-tile-key"
              value={asset.key}
              placeholder="products/hat/side.jpg"
              spellCheck={false}
              disabled={disabled}
              aria-label={`Image ${i + 1} file`}
              onChange={(e) => update(i, withAsset(item, { key: e.target.value }))}
            />
            <input
              className="input fc-tile-alt"
              value={asset.alt ?? ""}
              placeholder="Alt text"
              disabled={disabled}
              aria-label={`Image ${i + 1} alt text`}
              onChange={(e) => update(i, withAsset(item, { alt: e.target.value }))}
            />
            <div className="fc-tile-actions">
              <button
                type="button"
                className="fc-mini"
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
                aria-label="Move earlier"
              >
                ←
              </button>
              <button
                type="button"
                className="fc-mini"
                disabled={disabled || i === list.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move later"
              >
                →
              </button>
              <button
                type="button"
                className="fc-mini"
                disabled={disabled}
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                aria-label={`Remove image ${i + 1}`}
              >
                <IconClose size={11} />
              </button>
            </div>
          </figure>
        );
      })}
      <button
        type="button"
        className="fc-tile fc-tile-add"
        disabled={disabled}
        onClick={() => onChange([...list, { key: "" }])}
      >
        <span>Add image</span>
      </button>
    </div>
  );
}

/* ---- structure ----------------------------------------------------------- */

function GroupControl({ field, value, onChange, disabled, path, problems }: InputProps) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return (
    <div className="fc-group">
      {(field.fields ?? []).map((child) => (
        <FieldRow
          key={child.name}
          field={child}
          value={record[child.name]}
          path={`${path}.${child.name}`}
          problems={problems}
          disabled={disabled}
          onChange={(next) => {
            const out = { ...record, [child.name]: next };
            if (next === "" || next === undefined) delete out[child.name];
            onChange(out);
          }}
        />
      ))}
    </div>
  );
}

/** The line that names a list item when it is folded: its first text value. */
function itemSummary(item: unknown, fields: readonly SchemaFieldDto[], index: number): string {
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const parts = fields
      .filter((f) => ["string", "select", "reference"].includes(f.type))
      .map((f) => record[f.name])
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .slice(0, 3);
    if (parts.length > 0) return parts.join(" · ");
  }
  if (typeof item === "string" || typeof item === "number") return String(item);
  return `Item ${index + 1}`;
}

/**
 * Repeatable groups: variants, FAQ entries, line items. Each item folds to a
 * one-line summary so a product with twenty variants stays scannable.
 */
function ListControl({ field, value, onChange, disabled, path, problems }: InputProps) {
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  const item = field.items;
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(list.length <= 3 ? list.map((_, i) => i) : []),
  );
  if (!item)
    return (
      <JsonControl {...({ field, value, onChange, disabled, path, problems } as InputProps)} />
    );
  const childFields = item.type === "object" ? (item.fields ?? []) : [{ ...item, name: "value" }];
  const max = field.constraints?.maxItems;
  const noun = singular(labelOf(field));

  const update = (i: number, next: unknown) =>
    onChange(list.map((entry, j) => (j === i ? next : entry)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setOpen((prev) => {
      const out = new Set<number>();
      for (const k of prev) out.add(k === i ? j : k === j ? i : k);
      return out;
    });
  };
  const toggle = (i: number) =>
    setOpen((prev) => {
      const out = new Set(prev);
      if (out.has(i)) out.delete(i);
      else out.add(i);
      return out;
    });
  const hasProblem = (i: number) =>
    [...problems.keys()].some((key) => key === `${path}.${i}` || key.startsWith(`${path}.${i}.`));

  return (
    <div className="fc-list">
      {list.length === 0 ? (
        <p className="fc-list-empty">No {labelOf(field).toLowerCase()} yet.</p>
      ) : null}
      <ol className="fc-items">
        {list.map((entry, i) => (
          <li
            key={i}
            className="fc-item"
            data-open={open.has(i) || undefined}
            data-invalid={hasProblem(i) || undefined}
          >
            <div className="fc-item-head">
              <button
                type="button"
                className="fc-item-toggle"
                aria-expanded={open.has(i)}
                onClick={() => toggle(i)}
              >
                <IconCaretDown size={12} className="fc-item-caret" />
                <span className="fc-item-index" data-numeric="">
                  {i + 1}
                </span>
                <span className="fc-item-summary">{itemSummary(entry, childFields, i)}</span>
                {hasProblem(i) ? <IconWarning size={13} className="fc-item-warn" /> : null}
              </button>
              <div className="fc-item-actions">
                <button
                  type="button"
                  className="fc-mini"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${noun} ${i + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="fc-mini"
                  disabled={disabled || i === list.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${noun} ${i + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="fc-mini"
                  disabled={disabled}
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                  aria-label={`Remove ${noun} ${i + 1}`}
                >
                  <IconClose size={11} />
                </button>
              </div>
            </div>
            {open.has(i) ? (
              <div className="fc-item-body">
                {item.type === "object" ? (
                  <GroupControl
                    field={item}
                    value={entry}
                    path={`${path}.${i}`}
                    problems={problems}
                    disabled={disabled}
                    inputId=""
                    onChange={(next) => update(i, next)}
                  />
                ) : (
                  <FieldRow
                    field={{ ...item, name: `${noun} ${i + 1}`, optional: false }}
                    value={entry}
                    path={`${path}.${i}`}
                    problems={problems}
                    disabled={disabled}
                    onChange={(next) => update(i, next)}
                  />
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="fc-add"
        disabled={disabled || (max !== undefined && list.length >= max)}
        onClick={() => {
          onChange([...list, emptyValue(item) ?? ""]);
          setOpen((prev) => new Set(prev).add(list.length));
        }}
      >
        + Add {noun}
      </button>
    </div>
  );
}

/** The last resort, for `json` fields: edit as JSON, refuse what does not parse. */
function JsonControl({ value, onChange, disabled, inputId, describedBy }: InputProps) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <textarea
        id={inputId}
        className="input textarea fc-json"
        rows={Math.min(14, text.split("\n").length + 1)}
        value={text}
        spellCheck={false}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad ? (
        <p className="fr-problem">This isn't valid JSON yet; it won't be saved until it is.</p>
      ) : null}
    </>
  );
}

/**
 * How an option is shown when it declares no label: a lowercase key is
 * humanised ("in-stock" -> "In stock"), anything else is already how people
 * write it ("XS", "Q4 2026") and is left alone.
 */
export function optionText(option: { value: string; label?: string }): string {
  if (option.label) return option.label;
  return /^[a-z][a-z0-9_-]*$/.test(option.value) ? humanise(option.value) : option.value;
}

/** Format a list cell for a field: money as money, choices by label. */
export function formatCell(field: SchemaFieldDto | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (!field) return String(value);
  if (field.format === "money" && typeof value === "number") {
    return formatMoney(value, field.constraints?.currency ?? "USD");
  }
  if (field.type === "select") {
    const option = field.options?.find((candidate) => candidate.value === value);
    return optionText(option ?? { value: String(value) });
  }
  if (field.type === "reference") return humanise(String(value));
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "datetime" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString(undefined, { dateStyle: "medium" });
  }
  return String(value);
}
