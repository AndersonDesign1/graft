/**
 * Docs navigation — sections and pages, read from the content index and
 * grouped/sorted here. Section order is deliberate (a reading path, not
 * alphabetical); a section missing from the list sorts last so new content
 * never vanishes from the sidebar.
 */
import { getGraft } from "./graft";

export const SECTION_ORDER = [
  "Start here",
  "Content",
  "Runtime",
  "Agents",
  "Primitives",
  "Deploy",
  "Reference",
] as const;

export interface DocNavEntry {
  slug: string;
  title: string;
  description: string;
}

export interface DocNavSection {
  section: string;
  entries: DocNavEntry[];
}

export async function docsNav(): Promise<DocNavSection[]> {
  const docs = await getGraft().listContent("docs");

  const bySection = new Map<string, DocNavEntry[]>();
  const orderOf = new Map(docs.map((d) => [d.slug, d.data.order ?? 99]));
  for (const doc of docs) {
    const list = bySection.get(doc.data.section) ?? [];
    list.push({ slug: doc.slug, title: doc.data.title, description: doc.data.description });
    bySection.set(doc.data.section, list);
  }

  const rank = (s: string): number => {
    const i = (SECTION_ORDER as readonly string[]).indexOf(s);
    return i === -1 ? SECTION_ORDER.length : i;
  };

  return [...bySection.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([section, entries]) => ({
      section,
      entries: entries.sort(
        (a, b) => (orderOf.get(a.slug) ?? 99) - (orderOf.get(b.slug) ?? 99),
      ),
    }));
}
