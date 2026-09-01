/**
 * The plain-text surface: /llms.txt, /llms-full.txt, and /docs/<slug>.md.
 *
 * All three are the same idea. An agent reading these docs should not have to
 * parse a Fumadocs page to find prose that is already sitting in the index as
 * authored Markdown. The HTML is the rendering; this is the source.
 *
 * Built from the content index and the same section grouping the sidebar uses,
 * so the index cannot drift from the navigation. A doc added to the collection
 * appears in all four surfaces at once.
 *
 * Format follows llmstxt.org: an H1, a blockquote summary, then H2 sections of
 * links. Links point at the .md URLs rather than the HTML pages, because the
 * whole point is to hand over something already parsed.
 */
import type { DocNavSection } from "./nav";

/** One line of prose under the H1, before the sections. */
const SUMMARY =
  "Graft is an agent-native CMS. Content is MDX in git, Postgres (or a static SQLite artifact) is a derived index, and every surface a human uses has an equivalent an agent can call.";

const NOTES = [
  "Every page below is also available as Markdown at the same path with a .md suffix.",
  "The whole corpus in one file: /llms-full.txt",
  "Source and issues: https://github.com/AndersonDesign1/graft",
];

const absolute = (origin: string, path: string): string => new URL(path, origin).toString();

/** The llms.txt index: every doc as a titled, described link to its .md. */
export function renderLlmsIndex(sections: readonly DocNavSection[], origin: string): string {
  const body = sections
    .map(({ section, entries }) =>
      [
        `## ${section}`,
        "",
        ...entries.map(
          ({ slug, title, description }) =>
            `- [${title}](${absolute(origin, `/docs/${slug}.md`)}): ${description}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");

  return `${["# Graft", "", `> ${SUMMARY}`, "", ...NOTES.map((note) => `- ${note}`), ""].join("\n")}\n${body}\n`;
}

/** One document as standalone Markdown: its title, its summary, its body. */
export function renderDocMarkdown(doc: {
  title: string;
  description: string;
  body: string;
}): string {
  // The body's own headings start at ##, so the title is the only h1 and the
  // file reads as one document rather than a fragment someone has to place.
  return `# ${doc.title}\n\n> ${doc.description}\n\n${doc.body.trim()}\n`;
}

/** Every document inline, in reading order, separated so a parser can split. */
export function renderLlmsFull(
  sections: readonly DocNavSection[],
  bodies: ReadonlyMap<string, { title: string; description: string; body: string }>,
  origin: string,
): string {
  const documents = sections.flatMap(({ section, entries }) =>
    entries.flatMap(({ slug }) => {
      const doc = bodies.get(slug);
      if (!doc) return [];
      return [
        [
          `<!-- source: ${absolute(origin, `/docs/${slug}`)} -->`,
          `<!-- section: ${section} -->`,
          "",
          renderDocMarkdown(doc),
        ].join("\n"),
      ];
    }),
  );

  return `${["# Graft — full documentation", "", `> ${SUMMARY}`, ""].join("\n")}\n${documents.join("\n---\n\n")}`;
}

/** Text responses that proxies and agents can cache but never re-encode. */
export const textResponse = (body: string, contentType: string): Response =>
  new Response(body, {
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      // Public, cacheable, and revalidated in the background: these are derived
      // from the index, so a stale copy is a compile behind, never wrong.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
