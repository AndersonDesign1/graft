import type { SchemaFieldDto, SchemaList } from "../../types";
import { IconDatabase, IconFile } from "../components/icons";
import { EmptyState, IdentityMark, Pill, Status } from "../components/primitives";
import { useResource } from "../lib/use-resource";
import { plural } from "../lib/format";

/** Object/array fields nest, so rows recurse with an indent depth. */
function FieldRow({ field, depth = 0 }: { field: SchemaFieldDto; depth?: number }) {
  const children = field.fields ?? (field.items ? [field.items] : []);
  return (
    <>
      <tr data-depth={depth}>
        <td>
          <span className="field-name" style={{ paddingLeft: `${depth * 1.1}rem` }}>
            {field.name}
          </span>
        </td>
        <td>
          <code className="type">{field.type}</code>
        </td>
        <td>
          {field.optional ? (
            <span className="muted">optional</span>
          ) : (
            <span className="tag" data-tone="required">
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

export function SchemaView() {
  const { data, error, loading } = useResource<SchemaList>("/collections");
  const collections = data?.collections ?? [];

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Schema</h1>
          <p className="view-sub">
            What <code>graft.config.ts</code> declares — the same shape agents get from
            <code> describe_schema</code>.
          </p>
        </div>
      </header>

      <Status loading={loading && !data} error={error} empty={collections.length === 0}>
        <EmptyState
          title="No collections registered"
          body={
            <>
              Define one with <code>defineCollection</code> in <code>graft.config.ts</code>.
            </>
          }
        />
      </Status>

      <ul className="stack">
        {collections.map((collection) => (
          <li key={collection.name}>
            <section className="card">
              <div className="card-head">
                <div className="card-head-title">
                  <IdentityMark name={collection.name} />
                  <div>
                    <h2 className="card-title">{collection.name}</h2>
                    <p className="card-sub">
                      {collection.description ?? <span className="muted">No description</span>}
                    </p>
                  </div>
                </div>
                <Pill
                  tone={collection.authority === "db" ? "db" : "neutral"}
                  title={collection.authorityRaw}
                >
                  {collection.authority === "db" ? (
                    <IconDatabase size={12} />
                  ) : (
                    <IconFile size={12} />
                  )}
                  {collection.authority === "db" ? "db rows" : "mdx files"}
                </Pill>
              </div>

              {collection.fields.length === 0 ? (
                <p className="muted">No fields declared.</p>
              ) : (
                <table className="table table-tight">
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
