import { Children, type ComponentPropsWithoutRef, isValidElement, type ReactNode } from "react";

/** The plain text of a React subtree: what a header cell says. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The column headings (the first row of the head), for the region's name. */
function headings(children: ReactNode): string[] {
  for (const section of Children.toArray(children)) {
    if (!isValidElement<{ children?: ReactNode }>(section) || section.type !== "thead") continue;
    const row = Children.toArray(section.props.children)[0];
    if (!isValidElement<{ children?: ReactNode }>(row)) return [];
    return Children.toArray(row.props.children)
      .map((cell) => textOf(cell).trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Every Markdown table, in a frame. The frame carries the border and the
 * rounded corners (a table cannot clip its own), and scrolls sideways on a
 * narrow screen so a wide table never widens the page.
 *
 * A region that can scroll must be reachable by keyboard, so the frame is
 * focusable, and it is named after its columns ("Table: Framework, Package,
 * Guide") so a screen reader can tell one table from the next. Static HTML
 * cannot know which tables overflow, so every frame takes a tab stop.
 */
export function Table(props: ComponentPropsWithoutRef<"table">) {
  const columns = headings(props.children);
  const label = columns.length > 0 ? `Table: ${columns.join(", ")}` : "Table";
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table {...props} />
    </div>
  );
}
