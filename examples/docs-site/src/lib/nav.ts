/**
 * Docs navigation — sections and pages, read from the content index and
 * grouped/sorted here. Section order is deliberate (a reading path, not
 * alphabetical); a section missing from the list sorts last so new content
 * never vanishes from the sidebar.
 *
 * The order itself lives on the `docs` collection in graft.config.ts, so this
 * sidebar and the Studio's content tree sort from one declaration instead of
 * keeping their own copies in step by hand.
 */
import { docs as docsCollection } from "../../graft.config";
import { getGraft } from "./graft";

export const SECTION_ORDER = docsCollection.sections ?? [];

export interface DocNavEntry {
  slug: string;
  title: string;
  description: string;
}

export interface DocNavSection {
  section: string;
  entries: DocNavEntry[];
}

export interface DocNavSourceEntry extends DocNavEntry {
  section: string;
  order?: number;
}

/** Group indexed docs without touching the database, preserving sidebar semantics. */
export function groupDocsNav(
  docs: readonly DocNavSourceEntry[],
  sectionOrder: readonly string[] = SECTION_ORDER,
): DocNavSection[] {
  const bySection = new Map<string, Array<{ entry: DocNavEntry; order: number }>>();
  for (const doc of docs) {
    const list = bySection.get(doc.section) ?? [];
    list.push({
      entry: { slug: doc.slug, title: doc.title, description: doc.description },
      order: doc.order ?? 99,
    });
    bySection.set(doc.section, list);
  }

  const rank = (section: string): number => {
    const index = sectionOrder.indexOf(section);
    return index === -1 ? sectionOrder.length : index;
  };

  return [...bySection.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([section, entries]) => ({
      section,
      entries: entries.sort((a, b) => a.order - b.order).map(({ entry }) => entry),
    }));
}

/** The docsNav sections as a fumadocs PageTree (serializable — strings only). */
export async function docsPageTree(): Promise<{
  name: string;
  children: Array<
    { type: "separator"; name: string } | { type: "page"; name: string; url: string }
  >;
}> {
  const sections = await docsNav();
  const children: Array<
    { type: "separator"; name: string } | { type: "page"; name: string; url: string }
  > = [];
  for (const { section, entries } of sections) {
    children.push({ type: "separator", name: section });
    for (const entry of entries) {
      children.push({ type: "page", name: entry.title, url: `/docs/${entry.slug}` });
    }
  }
  return { name: "Graft docs", children };
}

export async function docsNav(): Promise<DocNavSection[]> {
  const docs = await getGraft().listContent("docs");
  return groupDocsNav(
    docs.map((doc) => ({
      slug: doc.slug,
      title: doc.data.title,
      description: doc.data.description,
      section: doc.data.section,
      order: doc.data.order,
    })),
  );
}
