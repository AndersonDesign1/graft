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
  "Graft is an open-source CMS that keeps content as Markdown files in Git, checks every file against a TypeScript schema, and gives your app fully typed reads. AI agents can edit the same content through the Model Context Protocol (MCP), within limits you set.";

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

const ENGINE_NOTE = new Map([
  ["static", "> Works on the static storage engine."],
  ["postgres", "> Needs the Postgres storage engine."],
  ["either", "> Works on both storage engines, static and Postgres."],
]);

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * The site's own MDX components, rewritten as the Markdown they stand for.
 *
 * The .md twin used to hand agents raw JSX: `<Callout label=…>`, `<Tabs>`,
 * `<DocCard href=…>`. A model can read that, but it is noise, and a person
 * pasting the page into a chat gets markup instead of text. Only whole-line
 * component tags outside code fences are rewritten, so a `<Callout>` shown as
 * an example inside a fence survives untouched.
 */
export function componentsToMarkdown(body: string): string {
  const out: string[] = [];
  let inFence = false;
  let inCallout = false;
  let tabLabels: string[] = [];
  let tabIndex = 0;

  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const trimmed = line.trim();
    if (inFence || !trimmed.startsWith("<")) {
      out.push(inCallout && !inFence ? (trimmed ? `> ${trimmed}` : ">") : line);
      continue;
    }

    const kicker = /^<p className="kicker">(.*)<\/p>$/.exec(trimmed);
    if (kicker) {
      out.push(`*${kicker[1]}*`);
    } else if (trimmed.startsWith("<Callout")) {
      const label = attr(trimmed, "label");
      out.push(label ? `> **${/[.?!]$/.test(label) ? label : `${label}.`}**` : ">");
      inCallout = true;
    } else if (trimmed === "</Callout>") {
      inCallout = false;
    } else if (trimmed.startsWith("<TierBadge")) {
      const note = ENGINE_NOTE.get(attr(trimmed, "tier") ?? "");
      if (note) out.push(note);
    } else if (trimmed.startsWith("<Tabs")) {
      tabLabels = (attr(trimmed, "labels") ?? "").split(",").map((label) => label.trim());
      tabIndex = 0;
    } else if (trimmed === "<Tab>") {
      const label = tabLabels[tabIndex++];
      if (label) out.push(`**${label}:**`);
    } else if (trimmed.startsWith("<Step ")) {
      const title = attr(trimmed, "title");
      if (title) out.push(`**${title}**`);
    } else if (trimmed.startsWith("<CodeBlock")) {
      const title = attr(trimmed, "title");
      if (title && title !== "terminal") out.push(`\`${title}\`:`);
    } else if (trimmed.startsWith("<DocCard ")) {
      const title = attr(trimmed, "title");
      const href = attr(trimmed, "href");
      out.push(`- [${title}](${href}):`);
    } else if (trimmed.startsWith("<FieldTable")) {
      out.push(
        `(Field table for the \`${attr(trimmed, "collection")}\` collection: see the HTML page.)`,
      );
    } else if (
      /^<\/?(Tabs|Steps|DocCards)>$/.test(trimmed) ||
      /^<\/(Tab|Step|CodeBlock|DocCard)>$/.test(trimmed)
    ) {
      // Pure wrappers: their content is already in place.
    } else {
      out.push(inCallout ? `> ${trimmed}` : line);
    }
  }

  // Card bodies sit on the lines after "- [Title](href):"; pull each onto its bullet.
  return out
    .join("\n")
    .replace(/^(- \[[^\]]*\]\([^)]*\):)\n\s+(.+)$/gm, "$1 $2")
    .replace(/\n{3,}/g, "\n\n");
}

/** One document as standalone Markdown: its title, its summary, its body. */
export function renderDocMarkdown(doc: {
  title: string;
  description: string;
  body: string;
}): string {
  // The body's own headings start at ##, so the title is the only h1 and the
  // file reads as one document rather than a fragment someone has to place.
  return `# ${doc.title}\n\n> ${doc.description}\n\n${componentsToMarkdown(doc.body.trim())}\n`;
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
