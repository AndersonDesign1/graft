/**
 * FieldTable — a collection's fields, read from the schema rather than typed.
 *
 * A hand-written field table is a copy of the schema, and copies drift. This
 * one calls `describe()` on the live collection, which is the same descriptor
 * MCP's `describe_schema` hands agents and the Studio renders its schema view
 * from. Rename a field and the docs page changes on the next compile; there is
 * nothing to remember to update, because there is nothing to update.
 *
 * It renders on the server inside `renderMdx`, so importing graft.config here
 * costs the page nothing at runtime.
 *
 * Nested fields are shown one level deep, indented under their parent. Deeper
 * than that a table stops being the right shape, and the honest answer for a
 * genuinely nested schema is prose plus an example rather than a wider table.
 */
import type { FieldDescriptor } from "@usegraft/contracts";
import { collections } from "../../../graft.config";

export interface FieldTableProps {
  /** Collection name as declared in graft.config, e.g. "docs". */
  collection: string;
}

/** A field plus how deep it sits, flattened so the table can render one pass. */
interface Row {
  field: FieldDescriptor;
  depth: number;
  /** Unique within the table; a nested `key` can repeat a top-level name. */
  path: string;
}

function rowsFor(fields: readonly FieldDescriptor[], depth = 0, prefix = ""): Row[] {
  return fields.flatMap((field) => {
    const path = prefix === "" ? field.name : `${prefix}.${field.name}`;
    const row: Row = { field, depth, path };
    if (depth > 0) return [row];

    // One level down, and only where there is something to show. `items`
    // describes an array's element; when that element is an object its own
    // fields are what the author actually writes.
    const nested = field.fields ?? field.items?.fields ?? [];
    return [row, ...rowsFor(nested, depth + 1, path)];
  });
}

export function FieldTable({ collection }: FieldTableProps) {
  // Looked up by a name the author typed, which may be any string — so match on
  // the entries rather than asserting the key into the config's exact shape.
  const declared = Object.entries(collections).find(([name]) => name === collection)?.[1];
  if (!declared) {
    // Loud rather than empty. A silent table would read as "this collection has
    // no fields", which is a lie the reader has no way to catch.
    return (
      <p className="field-table-missing">
        No collection named <code>{collection}</code> is registered. Known collections:{" "}
        {Object.keys(collections).join(", ") || "(none)"}.
      </p>
    );
  }

  const rows = rowsFor(declared.describe().fields);
  if (rows.length === 0) return <p className="field-table-missing">No fields declared.</p>;

  return (
    <div className="field-table-wrap">
      <table className="field-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Required</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ field, depth, path }) => (
            <tr key={path} data-depth={depth}>
              <td>
                <code className="field-name">{field.name}</code>
              </td>
              <td>
                <span className="field-type">{field.type}</span>
              </td>
              <td>{field.optional ? "" : "yes"}</td>
              <td>{field.description ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
