/**
 * Where a page's words live, relative to the repository root. Every doc is an
 * MDX file, except the error reference, which is generated from the error
 * registry. Pointing its edit link (or its "last updated" date) at the
 * generated file would invite an edit the next regeneration erases.
 */
export function docSourcePath(slug: string): string {
  return slug === "errors"
    ? "packages/mcp/src/explain.ts"
    : `examples/docs-site/content/docs/${slug}.mdx`;
}
