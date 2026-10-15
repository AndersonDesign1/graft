/**
 * The files `graft create` writes: the schema and example content from a
 * template, an AGENTS.md for whoever opens the folder next, and, for a Next.js
 * site, a small app that lists and renders every collection.
 *
 * Pure: it returns paths and contents, and the command writes them. That is
 * what lets the tests check every template compiles without a disk or a
 * network.
 */
import { barrelSource } from "@usegraft/registry";
import { templateFor, type TemplateName } from "./templates";

export type Framework = "next" | "none";

export interface ScaffoldOptions {
  /** The package name, from the folder. */
  name: string;
  template: TemplateName;
  framework: Framework;
  /** Where content is authoritative: files in git, or the database (edited online). */
  source: "git" | "database";
  /** Where the compiled index lives. A database source always means Postgres. */
  index: "static" | "postgres";
  /** The Graft version to depend on (the CLI's own). */
  graftVersion: string;
}

const NEXT_VERSION = "^16.0.0";
const REACT_VERSION = "^19.0.0";

function configSource(options: ScaffoldOptions): string {
  const template = templateFor(options.template);
  const index =
    options.index === "static"
      ? `// The content index is a file (.graft/index.db) that \`graft compile\` writes:
// no database needed. Switch to "postgres" (with DATABASE_URL) for Studio
// accounts, editing online, and typed functions.
export const index = "static";`
      : `// The content index lives in Postgres, at DATABASE_URL in .env.
export const index = "postgres";`;
  const content =
    options.source === "database"
      ? `

// Content is edited online, in Studio, and kept in the database: publishing
// puts a change live straight away. \`graft pull\` writes it to files when you
// want them.
export const content = { source: "database" };`
      : "";
  return `/**
 * This site's schema: every kind of content it has, and the fields of each.
 * Edit it to add a field or a collection; Studio and the site follow.
 */
import { defineCollection, field, mergePrimitives } from "@usegraft/core";
import * as primitives from "./graft";

${index}${content}

${template.collections}

export const { collections, functions } = mergePrimitives([
  { collections: { ${template.collectionNames.join(", ")} } },
  primitives,
]);
`;
}

function agentsMd(options: ScaffoldOptions): string {
  const template = templateFor(options.template);
  const online = options.source === "database";
  const run = (script: string) => `npm run ${script}`;
  return `# Working on this site

This site uses Graft: content is MDX checked against one schema in
\`graft.config.ts\`. Read the setup guide for agents before you change
anything: https://graft.page/start.md

## Where things are

- \`graft.config.ts\`: the schema. Collections: ${template.collectionNames.map((name) => `\`${name}\``).join(", ")}.
- ${online ? "Content is kept in the database and edited in Studio. Files under `content/` are a copy: `npx graft pull` refreshes them and `npx graft push` publishes your changes." : "`content/<collection>/<slug>.mdx`: one file per document. Git is the history."}
${options.framework === "next" ? "- `app/`: the Next.js site. `lib/graft.ts` reads the content.\n" : ""}
## Commands

- \`${run("dev")}\`: ${options.framework === "next" ? "the site at http://localhost:3000, recompiling content as it changes" : "recompile content as it changes"}.
- \`${run("studio")}\`: Studio, the editor, at http://localhost:4983.
- \`npx graft doctor\`: what is set up and the one thing to do next.
- \`npx graft check\`: check every content file against the schema.

## Rules

- Every Graft error has a \`fix\`. Do what it says, then try again.
- Never put a password, a database URL or a secret in a file you commit. They live in \`.env\`.
- ${online ? "Publishing makes a change live immediately. Ask the owner before publishing for them." : "Commit content changes with git, like code."}
`;
}

function gitignore(options: ScaffoldOptions): string {
  return [
    "node_modules/",
    "# Secrets: the database URL and Studio's session secret.",
    ".env",
    "# Derived: `graft compile` rebuilds it, and the free database's claim details.",
    ".graft/",
    ...(options.framework === "next" ? [".next/", "next-env.d.ts"] : []),
    "",
  ].join("\n");
}

function packageJson(options: ScaffoldOptions): string {
  const graft = options.graftVersion;
  const next = options.framework === "next";
  const pkg = {
    name: options.name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: next
      ? {
          dev: "graft compile && next dev",
          build: "graft compile && next build",
          start: "next start",
          studio: "graft studio",
          doctor: "graft doctor",
        }
      : {
          dev: "graft dev",
          build: "graft compile",
          studio: "graft studio",
          doctor: "graft doctor",
        },
    dependencies: {
      "@usegraft/core": graft,
      "@usegraft/db": graft,
      ...(next
        ? {
            "@usegraft/sdk-next": graft,
            next: NEXT_VERSION,
            react: REACT_VERSION,
            "react-dom": REACT_VERSION,
          }
        : {}),
    },
    devDependencies: {
      "@usegraft/cli": graft,
      ...(next
        ? {
            "@types/node": "^22.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            typescript: "^5.8.0",
          }
        : {}),
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function nextFiles(options: ScaffoldOptions): Record<string, string> {
  const template = templateFor(options.template);
  const reader =
    options.index === "static"
      ? `import { openStaticIndex } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-next";
import { collections } from "../graft.config";

/** Reads the content index that \`graft compile\` writes to .graft/index.db. */
export const graft = createGraft({
  index: await openStaticIndex(".graft/index.db"),
  collections,
});`
      : `import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-next";
import { collections } from "../graft.config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set: add it to .env (npx graft doctor explains).");

/** Reads the content index in Postgres, where a publish in Studio lands. */
export const graft = createGraft({ db: createDb(url).db, collections });`;

  const site = `/**
 * What the pages need from the content: every collection's entries, in the
 * order a reader expects, and one entry by its slug.
 */
import { collections } from "../graft.config";
import { graft } from "./graft";

export type CollectionName = keyof typeof collections & string;

/** The collections the site lists, in navigation order. */
export const LISTED: CollectionName[] = ${JSON.stringify(template.collectionNames.filter((name) => name !== "pages"))};

export const FEATURED: CollectionName | null = ${template.featured ? JSON.stringify(template.featured) : "null"};

export interface Entry {
  slug: string;
  title: string;
  /** The short line under the title: a summary, description or tagline. */
  line: string | null;
  body: string;
  data: Record<string, unknown>;
}

export function isCollection(name: string): name is CollectionName {
  return Object.hasOwn(collections, name);
}

function entry(doc: { slug: string; body: string; data: object }): Entry {
  const data = doc.data as Record<string, unknown>;
  const line = [data.summary, data.description, data.tagline].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    slug: doc.slug,
    title: typeof data.title === "string" ? data.title : doc.slug,
    line: line ?? null,
    body: doc.body,
    data,
  };
}

/** Newest first when entries have a date, in order when they have one, else by title. */
function byReadingOrder(a: Entry, b: Entry): number {
  const date = (e: Entry) => (e.data.date instanceof Date ? e.data.date.getTime() : Date.parse(String(e.data.date ?? "")));
  if (!Number.isNaN(date(a)) && !Number.isNaN(date(b))) return date(b) - date(a);
  if (typeof a.data.order === "number" && typeof b.data.order === "number") return a.data.order - b.data.order;
  if (typeof a.data.year === "number" && typeof b.data.year === "number") return b.data.year - a.data.year;
  return a.title.localeCompare(b.title);
}

export async function entries(collection: CollectionName): Promise<Entry[]> {
  const docs = await graft.listContent(collection);
  return docs.map(entry).sort(byReadingOrder);
}

export async function findEntry(collection: CollectionName, slug: string): Promise<Entry | null> {
  const doc = await graft.getContent(collection, slug);
  return doc ? entry(doc) : null;
}

export function label(collection: string): string {
  return collection.charAt(0).toUpperCase() + collection.slice(1);
}
`;

  return {
    "next.config.mjs": `import { withGraft } from "@usegraft/sdk-next/config";

export default withGraft({});
`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: false,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "react-jsx",
          incremental: true,
          plugins: [{ name: "next" }],
        },
        include: [
          "next-env.d.ts",
          "**/*.ts",
          "**/*.tsx",
          ".next/types/**/*.ts",
          ".next/dev/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      null,
      2,
    )}\n`,
    "lib/graft.ts": `${reader}\n`,
    "lib/site.ts": site,
    "app/globals.css": `:root {
  color-scheme: light dark;
  --paper: #fdfcfb;
  --ink: #1b1a16;
  --muted: #5c5a52;
  --line: rgb(27 26 22 / 0.12);
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0e0d0c;
    --ink: #f2f2ef;
    --muted: #bcbcb9;
    --line: rgb(242 242 239 / 0.14);
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 17px/1.7 system-ui, sans-serif;
}

.site {
  max-width: 42rem;
  margin: 0 auto;
  padding: 0 1rem 4rem;
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: 2.5rem;
}

.nav a {
  color: var(--muted);
  text-decoration: none;
}

.nav a:first-child {
  color: var(--ink);
  font-weight: 600;
  margin-right: auto;
}

h1 {
  font-size: 2.25rem;
  line-height: 1.2;
  margin: 0 0 0.5rem;
}

.line {
  color: var(--muted);
  margin: 0 0 2rem;
}

.list {
  list-style: none;
  padding: 0;
  margin: 2rem 0 0;
  border-top: 1px solid var(--line);
}

.list li {
  padding: 1rem 0;
  border-bottom: 1px solid var(--line);
}

.list a {
  color: inherit;
  font-weight: 600;
}

.list p {
  margin: 0.25rem 0 0;
  color: var(--muted);
}
`,
    "app/layout.tsx": `import type { ReactNode } from "react";
import Link from "next/link";
import { LISTED, label } from "../lib/site";
import "./globals.css";

export const metadata = { title: ${JSON.stringify(options.name)} };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="site">
          <nav className="nav">
            <Link href="/">${options.name}</Link>
            {LISTED.map((collection) => (
              <Link key={collection} href={\`/\${collection}\`}>
                {label(collection)}
              </Link>
            ))}
          </nav>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
`,
    "app/page.tsx": `import Link from "next/link";
import { MdxBody } from "@usegraft/sdk-next";
import { FEATURED, entries, findEntry } from "../lib/site";

export const dynamic = "force-dynamic";

export default async function Home() {
  const home = await findEntry("pages", "home");
  const featured = FEATURED ? await entries(FEATURED) : [];
  return (
    <>
      <h1>{home?.title ?? "Welcome"}</h1>
      {home?.line ? <p className="line">{home.line}</p> : null}
      {home ? <MdxBody source={home.body} /> : null}
      {featured.length > 0 ? (
        <ul className="list">
          {featured.map((item) => (
            <li key={item.slug}>
              <Link href={\`/\${FEATURED}/\${item.slug}\`}>{item.title}</Link>
              {item.line ? <p>{item.line}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
`,
    "app/[collection]/page.tsx": `import Link from "next/link";
import { notFound } from "next/navigation";
import { entries, isCollection, label } from "../../lib/site";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  if (!isCollection(collection)) notFound();
  const items = await entries(collection);
  return (
    <>
      <h1>{label(collection)}</h1>
      <ul className="list">
        {items.map((item) => (
          <li key={item.slug}>
            <Link href={\`/\${collection}/\${item.slug}\`}>{item.title}</Link>
            {item.line ? <p>{item.line}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
`,
    "app/[collection]/[slug]/page.tsx": `import { notFound } from "next/navigation";
import { MdxBody } from "@usegraft/sdk-next";
import { findEntry, isCollection } from "../../../lib/site";

export const dynamic = "force-dynamic";

export default async function EntryPage({
  params,
}: {
  params: Promise<{ collection: string; slug: string }>;
}) {
  const { collection, slug } = await params;
  if (!isCollection(collection)) notFound();
  const item = await findEntry(collection, slug);
  if (!item) notFound();
  return (
    <article>
      <h1>{item.title}</h1>
      {item.line ? <p className="line">{item.line}</p> : null}
      <MdxBody source={item.body} />
    </article>
  );
}
`,
  };
}

/** Every file a new site starts with, by path relative to its folder. */
export function scaffoldFiles(options: ScaffoldOptions): Record<string, string> {
  const template = templateFor(options.template);
  const files: Record<string, string> = {
    "graft.config.ts": configSource(options),
    "graft/index.ts": barrelSource([]),
    "AGENTS.md": agentsMd(options),
    ".gitignore": gitignore(options),
    "package.json": packageJson(options),
  };
  for (const [path, body] of Object.entries(template.documents)) {
    files[`content/${path}`] = body;
  }
  if (options.framework === "next") Object.assign(files, nextFiles(options));
  return files;
}
