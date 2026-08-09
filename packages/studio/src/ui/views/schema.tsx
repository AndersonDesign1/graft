import { useState } from "react";
import type { SchemaFieldDto, SchemaList } from "../../types";
import { IconDatabase, IconFile, IconSearch } from "../components/icons";
import { EmptyState, Pill, Status, TypeBadge } from "../components/primitives";
import { CollectionMark } from "../components/collection-icon";
import { CardsSkeleton } from "../components/skeletons";
import { useResource } from "../lib/use-resource";
import { plural } from "../lib/format";

/** Object/array fields nest, so rows recurse with an indent depth. */
function FieldRow({ field, depth = 0 }: { field: SchemaFieldDto; depth?: number }) {
  const children = field.fields ?? (field.items ? [field.items] : []);
  return (
    <>
      <tr data-depth={depth} data-nested={depth > 0}>
        <td>
          <span className="field-name" style={{ paddingLeft: `${depth * 1.15}rem` }}>
            {depth > 0 ? <span className="field-branch" aria-hidden="true" /> : null}
            {field.name}
          </span>
        </td>
        <td>
          <TypeBadge type={field.type} />
        </td>
        <td>
          {field.optional ? (
            <span className="req" data-required="false">
              optional
            </span>
          ) : (
            <span className="req" data-required="true">
              required
            </span>
          )}
        </td>
        <td className="desc">{field.description ?? <span className="muted">—</span>}</td>
      </tr>
      {children.map((child, i) => (
        <FieldRow key={`${field.name}-${child.name}-${i}`} field={child} depth={depth + 1} />
      ))}
    </>
  );
}

/** Flatten for search so a nested field still surfaces its parent. */
function matches(field: SchemaFieldDto, q: string): boolean {
  if (`${field.name} ${field.type} ${field.description ?? ""}`.toLowerCase().includes(q)) {
    return true;
  }
  const children = field.fields ?? (field.items ? [field.items] : []);
  return children.some((child) => matches(child, q));
}

export function SchemaView() {
  const { data, error, loading } = useResource<SchemaList>("/collections");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const collections = (data?.collections ?? [])
    .map((collection) => ({
      ...collection,
      fields: q ? collection.fields.filter((f) => matches(f, q)) : collection.fields,
    }))
    .filter((collection) => !q || collection.fields.length > 0 || collection.name.includes(q));

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Schema</h1>
          <p className="view-sub">
            What <code>graft.config.ts</code> declares — the same shape agents get from{" "}
            <code>describe_schema</code>.
          </p>
        </div>
        <div className="search search-inline">
          <IconSearch size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a field"
            aria-label="Find a field"
          />
        </div>
      </header>

      <Status
        loading={loading && !data}
        error={error}
        empty={collections.length === 0}
        skeleton={<CardsSkeleton />}
      >
        <EmptyState
          title={q ? "No matching fields" : "No collections registered"}
          body={
            q ? (
              "Nothing in any schema matches that."
            ) : (
              <>
                Define one with <code>defineCollection</code> in <code>graft.config.ts</code>.
              </>
            )
          }
        />
      </Status>

      <ul className="stack">
        {collections.map((collection) => (
          <li key={collection.name}>
            <section className="card">
              <div className="card-head">
                <div className="card-head-title">
                  <CollectionMark name={collection.name} authority={collection.authority} />
                  <div>
                    <h2 className="card-title">{collection.name}</h2>
                    <p className="card-sub">
                      {collection.description ?? <span className="muted">No description</span>}
                    </p>
                  </div>
                </div>
                <Pill
                  tone={collection.authority === "db" ? "db" : "file"}
                  title={collection.authorityRaw}
                >
                  {collection.authority === "db" ? (
                    <IconDatabase size={11} />
                  ) : (
                    <IconFile size={11} />
                  )}
                  {collection.authority === "db" ? "db rows" : "mdx files"}
                </Pill>
              </div>

              {collection.fields.length === 0 ? (
                <p className="muted">No fields declared.</p>
              ) : (
                <table className="table table-tight table-schema">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Type</th>
                      <th />
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collection.fields.map((field) => (
                      <FieldRow key={field.name} field={field} />
                    ))}
                  </tbody>
                </table>
              )}
              <p className="card-foot">{plural(collection.fields.length, "field")}</p>
            </section>
          </li>
        ))}
      </ul>
    </div>
  );
}
