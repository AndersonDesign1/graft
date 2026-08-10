/**
 * The document's frontmatter, as settings rather than as a debug panel.
 *
 * Every widget here is chosen by the collection's declared field type, not by
 * inspecting the value — see `lib/schema-form.ts` for why that distinction is
 * the whole point of the unit.
 *
 * What is deliberately *not* here: inline editing of object and array fields.
 * They are shown, summarised and labelled, and the edit goes through Raw MDX.
 * A nested editor has to re-serialise a shape it only partly models, and
 * anything it fails to model disappears on save — which is precisely the bug
 * this unit removed from the Rich/Raw switch. Visible-but-read-only is a big
 * improvement on invisible; visible-and-lossy would not be.
 */
import { useEffect, useState } from "react";
import type { SchemaFieldDto } from "../../types";
import { IconFile } from "./icons";
import {
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NumberField,
  Switch,
  Textarea,
} from "./ui/field";
import { api, qs } from "../lib/api";
import { buildForm, isEditable, type FormField } from "../lib/schema-form";

/** ISO 8601, the shape a `datetime` field validates against. */
const ISO_PLACEHOLDER = "2026-08-10T09:00:00Z";

export interface FrontmatterFormProps {
  data: Record<string, unknown>;
  schemaFields: SchemaFieldDto[] | undefined;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  /** Switch to Raw MDX — the edit path for shapes this form won't touch. */
  onEditRaw: () => void;
}

export function FrontmatterForm({
  data,
  schemaFields,
  values,
  onChange,
  disabled = false,
  onEditRaw,
}: FrontmatterFormProps) {
  const fields = buildForm(schemaFields, data);
  const declared = fields.filter((f) => !f.undeclared);
  const undeclared = fields.filter((f) => f.undeclared);

  if (fields.length === 0) {
    return (
      <section className="settings-card">
        <p className="settings-empty">This collection declares no frontmatter fields.</p>
      </section>
    );
  }

  return (
    <section className="settings-card" aria-label="Page settings">
      <header className="settings-head">
        <h2 className="settings-title">Page settings</h2>
        <span className="settings-count">
          {declared.length} {declared.length === 1 ? "field" : "fields"}
        </span>
      </header>

      <div className="settings-grid">
        {declared.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={onChange}
            disabled={disabled}
            onEditRaw={onEditRaw}
          />
        ))}
      </div>

      {undeclared.length > 0 ? (
        <>
          {/* Never hidden: these are authored bytes the schema stopped knowing
              about, usually mid-migration. Silently dropping them from the form
              is how they get silently dropped from the file. */}
          <div className="settings-divider">
            <span>Not in the schema</span>
          </div>
          <div className="settings-grid">
            {undeclared.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={onChange}
                disabled={disabled}
                onEditRaw={onEditRaw}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  disabled,
  onEditRaw,
}: {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled: boolean;
  onEditRaw: () => void;
}) {
  return (
    <Field className="settings-field" disabled={disabled}>
      <div className="settings-field-head">
        <FieldLabel className="settings-label">{field.key}</FieldLabel>
        <FieldMeta field={field} />
      </div>
      <Widget
        field={field}
        value={value}
        onChange={onChange}
        disabled={disabled}
        onEditRaw={onEditRaw}
      />
      {field.description ? (
        <FieldDescription className="settings-help">{field.description}</FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * Type chip plus a required marker — the two facts the schema knows and the old
 * form didn't. The chip is the Schema view's own `.type` component: a `datetime`
 * should not be one colour here and another there.
 */
function FieldMeta({ field }: { field: FormField }) {
  return (
    <span className="settings-meta">
      <span
        className="type"
        data-type={field.declaredType ?? "unknown"}
        title={field.declaredType ? undefined : "Present in the file, absent from the schema"}
      >
        {field.declaredType ?? "undeclared"}
      </span>
      {!field.optional ? (
        <span className="settings-required" title="Required by the schema">
          required
        </span>
      ) : null}
    </span>
  );
}

function Widget({
  field,
  value,
  onChange,
  disabled,
  onEditRaw,
}: {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled: boolean;
  onEditRaw: () => void;
}) {
  if (!isEditable(field.widget)) {
    return <StructuredValue value={value} onEditRaw={onEditRaw} />;
  }

  switch (field.widget) {
    case "boolean":
      return (
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(next) => onChange(field.key, next)}
          disabled={disabled}
        />
      );

    case "number":
      return (
        <NumberField
          value={typeof value === "number" ? value : null}
          onValueChange={(next) => onChange(field.key, next ?? "")}
          disabled={disabled}
        />
      );

    case "text":
      return (
        <Textarea
          rows={3}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );

    case "asset":
      return <AssetWidget field={field} value={value} onChange={onChange} disabled={disabled} />;

    // A `datetime` stays a text input on purpose. `<input type="datetime-local">`
    // has no timezone, so round-tripping an ISO string through it rewrites the
    // author's value — the same churn the whole save path is built to avoid.
    case "datetime":
      return (
        <Input
          value={String(value ?? "")}
          placeholder={ISO_PLACEHOLDER}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );

    default:
      return (
        <Input
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
  }
}

interface AssetValue {
  key: string;
  alt: string;
}

function asAsset(value: unknown): AssetValue {
  if (value && typeof value === "object") {
    const record = value as { key?: unknown; alt?: unknown };
    return { key: String(record.key ?? ""), alt: String(record.alt ?? "") };
  }
  return { key: "", alt: "" };
}

/**
 * An asset reference: its key, its alt text, and the image itself when the
 * project has a store configured. Before this, an asset field rendered as
 * nothing at all — `typeof value === "object"` fell through every branch.
 */
function AssetWidget({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled: boolean;
}) {
  const asset = asAsset(value);
  const preview = useAssetUrl(asset.key);

  const update = (patch: Partial<AssetValue>): void => {
    const next = { ...asset, ...patch };
    // Alt is optional in AssetRef; an empty one should not be written as "".
    onChange(field.key, next.alt ? next : { key: next.key });
  };

  return (
    <div className="asset-field">
      <div className="asset-preview" data-state={preview.state}>
        {preview.url ? (
          <img src={preview.url} alt={asset.alt || asset.key} loading="lazy" />
        ) : (
          <span className="asset-preview-fallback" title={preview.reason ?? undefined}>
            <IconFile size={14} />
          </span>
        )}
      </div>
      <div className="asset-inputs">
        <Input
          value={asset.key}
          placeholder="pages/home/hero.png"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => update({ key: e.target.value })}
        />
        <Input
          value={asset.alt}
          placeholder="Alt text"
          disabled={disabled}
          onChange={(e) => update({ alt: e.target.value })}
        />
      </div>
    </div>
  );
}

interface AssetPreview {
  url: string | null;
  reason: string | null;
  state: "idle" | "loading" | "resolved" | "unavailable";
}

/**
 * Resolve an asset key to a URL, debounced because the key is a text input the
 * operator types into character by character.
 */
function useAssetUrl(key: string): AssetPreview {
  const [preview, setPreview] = useState<AssetPreview>({
    url: null,
    reason: null,
    state: "idle",
  });

  useEffect(() => {
    if (!key.trim()) {
      setPreview({ url: null, reason: null, state: "idle" });
      return;
    }
    let cancelled = false;
    setPreview((prev) => ({ ...prev, state: "loading" }));
    const timer = setTimeout(() => {
      api<{ key: string; url: string | null; reason?: string }>(`/asset-url${qs({ key })}`)
        .then((res) => {
          if (cancelled) return;
          setPreview({
            url: res.url,
            reason: res.reason ?? null,
            state: res.url ? "resolved" : "unavailable",
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreview({
            url: null,
            reason: err instanceof Error ? err.message : String(err),
            state: "unavailable",
          });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return preview;
}

/** An object or array field: what it holds, and where to go to change it. */
function StructuredValue({ value, onEditRaw }: { value: unknown; onEditRaw: () => void }) {
  if (value === undefined || value === null) {
    return <p className="settings-structured is-empty">Not set — add it in Raw MDX.</p>;
  }

  return (
    <div className="settings-structured">
      <span className="settings-structured-summary">{summarise(value)}</span>
      <button type="button" className="settings-structured-edit" onClick={onEditRaw}>
        Edit in Raw MDX
      </button>
    </div>
  );
}

/** One line describing a nested value, without pretending to render it. */
function summarise(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object);
    return keys.length > 0 ? keys.join(", ") : "empty object";
  }
  return String(value);
}
