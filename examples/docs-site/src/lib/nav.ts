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
      entries: entries.sort((a, b) => (orderOf.get(a.slug) ?? 99) - (orderOf.get(b.slug) ?? 99)),
    }));
}
