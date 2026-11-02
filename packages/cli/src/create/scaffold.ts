/**
 * The files `graft create` writes: the schema and example content from a
 * template, an AGENTS.md for whoever opens the folder next, and, for a Next.js
 * Nuxt or SvelteKit site, a small app that lists and renders every collection.
 *
 * Pure: it returns paths and contents, and the command writes them. That is
 * what lets the tests check every template compiles without a disk or a
 * network.
 */
import { barrelSource } from "@usegraft/registry";
import { templateFor, type TemplateName } from "./templates";

export type Framework = "next" | "nuxt" | "sveltekit" | "none";

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
// `nuxt/server`, which the Graft module's server code imports, arrived in 4.6.0.
const NUXT_VERSION = "^4.6.0";
const VUE_VERSION = "^3.5.0";
// SvelteKit 3, which removed `$lib` (the site imports `#lib/…`) and needs
// TypeScript 6 and Node 22.17.
const SVELTEKIT_DEV_DEPENDENCIES = {
  "@sveltejs/adapter-node": "^6.0.0",
  "@sveltejs/kit": "^3.1.0",
  "@sveltejs/vite-plugin-svelte": "^7.0.0",
  svelte: "^5.57.0",
  typescript: "^6.0.0",
  vite: "^8.0.0",
};

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

function siteLine(framework: Framework): string {
  if (framework === "next")
    return "- `app/`: the Next.js site. `lib/graft.ts` reads the content.\n";
  if (framework === "nuxt") {
    return "- `app/`: the Nuxt site. `@usegraft/sdk-nuxt` in `nuxt.config.ts` reads the content, and `server/api/mdx/` compiles each body.\n";
  }
  if (framework === "sveltekit") {
    return "- `src/`: the SvelteKit site. `src/lib/server/` reads the content and prepares each body; `src/routes/` renders it.\n";
  }
  return "";
}

/** What `npm run dev` does, as AGENTS.md says it. */
function devLine(options: ScaffoldOptions): string {
  if (options.framework === "none") return "recompile content as it changes";
  // The site's dev script compiles once, at start. A static site reads the
  // file that compile writes; a Postgres site reads what Studio publishes.
  return options.index === "static"
    ? "the site at http://localhost:3000. It compiles content once at start: run `npx graft compile` after editing a content file"
    : "the site at http://localhost:3000, reading content from the database, so a publish in Studio shows on the next page load";
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
${siteLine(options.framework)}
## Commands

- \`${run("dev")}\`: ${devLine(options)}.
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
    ...(options.framework === "nuxt" ? [".nuxt/", ".output/"] : []),
    ...(options.framework === "sveltekit" ? [".svelte-kit/", "build/"] : []),
    "",
  ].join("\n");
}

/** A SvelteKit 3 site on Postgres declares the variable its server reads. */
const SVELTEKIT_ENV = `// The environment variables the server reads, from .env in development.
import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  DATABASE_URL: { description: "The Postgres connection string, in .env (npx graft doctor explains)." },
});
`;

/** The stylesheet every generated site starts with: plain CSS, light and dark. */
const SITE_CSS = `:root {
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
`;

/** Each framework's scripts and dependencies, on top of the ones every site has. */
interface FrameworkPackage {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Node subpath imports, for a framework that resolves its own aliases through them. */
  imports?: Record<string, string>;
}

function frameworkPackage(options: ScaffoldOptions): FrameworkPackage {
  const graft = options.graftVersion;
  if (options.framework === "next") {
    return {
      scripts: {
        dev: "graft compile && next dev",
        build: "graft compile && next build",
        start: "next start",
      },
      dependencies: {
        "@usegraft/sdk-next": graft,
        next: NEXT_VERSION,
        react: REACT_VERSION,
        "react-dom": REACT_VERSION,
      },
      devDependencies: {
        "@types/node": "^22.0.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        typescript: "^5.8.0",
      },
    };
  }
  if (options.framework === "nuxt") {
    return {
      scripts: {
        dev: "graft compile && nuxt dev",
        build: "graft compile && nuxt build",
        start: "node .output/server/index.mjs",
      },
      dependencies: { "@usegraft/sdk-nuxt": graft, nuxt: NUXT_VERSION, vue: VUE_VERSION },
      devDependencies: {},
    };
  }
  if (options.framework === "sveltekit") {
    return {
      scripts: {
        dev: "graft compile && vite dev --port 3000",
        build: "graft compile && vite build",
        start: "node build",
      },
      dependencies: { "@usegraft/sdk-sveltekit": graft },
      devDependencies: SVELTEKIT_DEV_DEPENDENCIES,
      imports: { "#lib/*": "./src/lib/*" },
    };
  }
  return {
    scripts: { dev: "graft dev", build: "graft compile" },
    dependencies: {},
    devDependencies: {},
  };
}

function packageJson(options: ScaffoldOptions): string {
  const graft = options.graftVersion;
  const site = frameworkPackage(options);
  const pkg = {
    name: options.name,
    version: "0.1.0",
    private: true,
    type: "module",
    // JSON.stringify leaves the key out when a framework has none.
    imports: site.imports,
    scripts: { ...site.scripts, studio: "graft studio", doctor: "graft doctor" },
    dependencies: {
      "@usegraft/core": graft,
      "@usegraft/db": graft,
      ...site.dependencies,
    },
    devDependencies: { "@usegraft/cli": graft, ...site.devDependencies },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function nextFiles(options: ScaffoldOptions) {
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
    "app/globals.css": SITE_CSS,
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

function nuxtFiles(options: ScaffoldOptions) {
  const template = templateFor(options.template);
  const listed = template.collectionNames.filter((name) => name !== "pages");
  const featured = template.featured;

  const site = `/**
 * What the pages need from the content: the collections the site lists, and
 * each document as an entry with a title, a short line and its fields.
 */
import { collections } from "~~/graft.config";

export type CollectionName = keyof typeof collections & string;

/** The collections the site lists, in navigation order. */
export const LISTED: CollectionName[] = ${JSON.stringify(listed)};

export interface Entry {
  slug: string;
  title: string;
  /** The short line under the title: a summary, description or tagline. */
  line: string | null;
  data: Record<string, unknown>;
}

export function isCollection(name: string): name is CollectionName {
  return Object.hasOwn(collections, name);
}

export function entry(doc: { slug: string; data: object }): Entry {
  const data = doc.data as Record<string, unknown>;
  const line = [data.summary, data.description, data.tagline].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    slug: doc.slug,
    title: typeof data.title === "string" ? data.title : doc.slug,
    line: line ?? null,
    data,
  };
}

/** Newest first when entries have a date, in order when they have one, else by title. */
export function byReadingOrder(a: Entry, b: Entry): number {
  const date = (e: Entry) => (e.data.date instanceof Date ? e.data.date.getTime() : Date.parse(String(e.data.date ?? "")));
  if (!Number.isNaN(date(a)) && !Number.isNaN(date(b))) return date(b) - date(a);
  if (typeof a.data.order === "number" && typeof b.data.order === "number") return a.data.order - b.data.order;
  if (typeof a.data.year === "number" && typeof b.data.year === "number") return b.data.year - a.data.year;
  return a.title.localeCompare(b.title);
}

export function label(collection: string): string {
  return collection.charAt(0).toUpperCase() + collection.slice(1);
}
`;

  const featuredScript = featured
    ? `
const { data: featured } = await useGraftList(${JSON.stringify(featured)});
const items = computed(() => (featured.value ?? []).map(entry).sort(byReadingOrder));`
    : "";
  const featuredList = featured
    ? `
  <ul v-if="items.length > 0" class="list">
    <li v-for="item in items" :key="item.slug">
      <NuxtLink :to="\`/${featured}/\${item.slug}\`">{{ item.title }}</NuxtLink>
      <p v-if="item.line">{{ item.line }}</p>
    </li>
  </ul>`
    : "";

  return {
    "nuxt.config.ts": `export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  modules: ["@usegraft/sdk-nuxt"],
  // The page composables read through the content API.
  graft: { contentApi: true },
  css: ["~/assets/site.css"],
  app: { head: { title: ${JSON.stringify(options.name)} } },
});
`,
    "tsconfig.json": `${JSON.stringify(
      {
        files: [],
        references: [
          { path: "./.nuxt/tsconfig.app.json" },
          { path: "./.nuxt/tsconfig.server.json" },
          { path: "./.nuxt/tsconfig.shared.json" },
          { path: "./.nuxt/tsconfig.node.json" },
        ],
      },
      null,
      2,
    )}\n`,
    "app/assets/site.css": SITE_CSS,
    "app/lib/site.ts": site,
    "app/app.vue": `<script setup lang="ts">
import { LISTED, label } from "~/lib/site";
</script>

<template>
  <div class="site">
    <nav class="nav">
      <NuxtLink to="/">${options.name}</NuxtLink>
      <NuxtLink v-for="collection in LISTED" :key="collection" :to="\`/\${collection}\`">
        {{ label(collection) }}
      </NuxtLink>
    </nav>
    <main><NuxtPage /></main>
  </div>
</template>
`,
    "app/pages/index.vue": `<script setup lang="ts">
import { byReadingOrder, entry } from "~/lib/site";

const { data: home } = await useGraftContent("pages", "home");
const page = computed(() => (home.value ? entry(home.value) : null));
const { data: mdx } = await useFetch("/api/mdx/pages/home");${featuredScript}
</script>

<template>
  <h1>{{ page?.title ?? "Welcome" }}</h1>
  <p v-if="page?.line" class="line">{{ page.line }}</p>
  <GraftMdx v-if="page && mdx" :code="mdx.code" />${featuredList}
</template>
`,
    "app/pages/[collection]/index.vue": `<script setup lang="ts">
import { byReadingOrder, entry, isCollection, label } from "~/lib/site";

const route = useRoute();
const collection = String(route.params.collection);
if (!isCollection(collection)) {
  throw createError({ statusCode: 404, statusMessage: "No such collection" });
}
const { data } = await useGraftList(collection);
const items = computed(() => (data.value ?? []).map(entry).sort(byReadingOrder));
</script>

<template>
  <h1>{{ label(collection) }}</h1>
  <ul class="list">
    <li v-for="item in items" :key="item.slug">
      <NuxtLink :to="\`/\${collection}/\${item.slug}\`">{{ item.title }}</NuxtLink>
      <p v-if="item.line">{{ item.line }}</p>
    </li>
  </ul>
</template>
`,
    "app/pages/[collection]/[slug].vue": `<script setup lang="ts">
import { entry, isCollection } from "~/lib/site";

const route = useRoute();
const collection = String(route.params.collection);
const slug = String(route.params.slug);
if (!isCollection(collection)) {
  throw createError({ statusCode: 404, statusMessage: "No such collection" });
}
const { data: doc, error } = await useGraftContent(collection, slug);
if (error.value) throw error.value;
if (!doc.value) throw createError({ statusCode: 404, statusMessage: "No such page" });
const item = computed(() => (doc.value ? entry(doc.value) : null));
const { data: mdx } = await useFetch(\`/api/mdx/\${collection}/\${slug}\`);
</script>

<template>
  <article v-if="item">
    <h1>{{ item.title }}</h1>
    <p v-if="item.line" class="line">{{ item.line }}</p>
    <GraftMdx v-if="mdx" :code="mdx.code" />
  </article>
</template>
`,
    "server/api/mdx/[collection]/[slug].get.ts": `/**
 * A document's MDX body, compiled on the server for <GraftMdx> to render.
 * \`useGraft\` and \`prepareMdx\` come from @usegraft/sdk-nuxt.
 */
import { createError, defineEventHandler, getRouterParam } from "nuxt/server";
import { collections } from "~~/graft.config";

const isCollection = (name: string): name is keyof typeof collections & string =>
  Object.hasOwn(collections, name);

export default defineEventHandler(async (event) => {
  const collection = getRouterParam(event, "collection") ?? "";
  const slug = getRouterParam(event, "slug") ?? "";
  if (!isCollection(collection)) throw createError({ statusCode: 404 });
  const graft = await useGraft();
  const doc = await graft.getContent(collection, slug);
  if (!doc) throw createError({ statusCode: 404 });
  return { code: await prepareMdx(doc.body) };
});
`,
  };
}

function sveltekitFiles(options: ScaffoldOptions) {
  const template = templateFor(options.template);
  const listed = template.collectionNames.filter((name) => name !== "pages");
  const featured = template.featured;

  const reader =
    options.index === "static"
      ? `import { openStaticIndex } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-sveltekit";
import { collections } from "../../../graft.config";

/** Reads the content index that \`graft compile\` writes to .graft/index.db. */
export const graft = createGraft({
  index: await openStaticIndex(".graft/index.db"),
  collections,
});`
      : `// SvelteKit 3 reads only the variables src/env.ts declares, and refuses to
// start without DATABASE_URL.
import { DATABASE_URL } from "$app/env/private";
import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-sveltekit";
import { collections } from "../../../graft.config";

/** Reads the content index in Postgres, where a publish in Studio lands. */
export const graft = createGraft({ db: createDb(DATABASE_URL).db, collections });`;

  const site = `/**
 * What the pages need from the content: the collections the site lists, and
 * each document as an entry with a title and a short line. Safe in the
 * browser: it reads nothing.
 */
import { collections } from "../../graft.config";

export type CollectionName = keyof typeof collections & string;

/** The collections the site lists, in navigation order. */
export const LISTED: CollectionName[] = ${JSON.stringify(listed)};

export const FEATURED: CollectionName | null = ${featured ? JSON.stringify(featured) : "null"};

export interface Entry {
  slug: string;
  title: string;
  /** The short line under the title: a summary, description or tagline. */
  line: string | null;
}

export function isCollection(name: string): name is CollectionName {
  return Object.hasOwn(collections, name);
}

export function label(collection: string): string {
  return collection.charAt(0).toUpperCase() + collection.slice(1);
}
`;

  const serverSite = `/**
 * Reading entries, on the server only: \`src/lib/server/\` never reaches the
 * browser.
 */
import { prepareMdx, type MdxTree } from "@usegraft/sdk-sveltekit/server";
import type { CollectionName, Entry } from "#lib/site.ts";
import { graft } from "./graft.ts";

function entry(doc: { slug: string; data: object }): Entry & { data: Record<string, unknown> } {
  const data = doc.data as Record<string, unknown>;
  const line = [data.summary, data.description, data.tagline].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    slug: doc.slug,
    title: typeof data.title === "string" ? data.title : doc.slug,
    line: line ?? null,
    data,
  };
}

/** Newest first when entries have a date, in order when they have one, else by title. */
function byReadingOrder(a: ReturnType<typeof entry>, b: ReturnType<typeof entry>): number {
  const date = (e: ReturnType<typeof entry>) =>
    e.data.date instanceof Date ? e.data.date.getTime() : Date.parse(String(e.data.date ?? ""));
  if (!Number.isNaN(date(a)) && !Number.isNaN(date(b))) return date(b) - date(a);
  if (typeof a.data.order === "number" && typeof b.data.order === "number") return a.data.order - b.data.order;
  if (typeof a.data.year === "number" && typeof b.data.year === "number") return b.data.year - a.data.year;
  return a.title.localeCompare(b.title);
}

/** A collection's entries in reading order, with only what a list shows. */
export async function entries(collection: CollectionName): Promise<Entry[]> {
  const docs = await graft.listContent(collection);
  return docs
    .map(entry)
    .sort(byReadingOrder)
    .map(({ slug, title, line }) => ({ slug, title, line }));
}

/** One entry with its body prepared for MdxContent, or null when there is none. */
export async function findEntry(
  collection: CollectionName,
  slug: string,
): Promise<(Entry & { body: MdxTree }) | null> {
  const doc = await graft.getContent(collection, slug);
  if (!doc) return null;
  const { title, line } = entry(doc);
  return { slug, title, line, body: prepareMdx(doc.body, { label: \`\${collection}/\${slug}\` }) };
}
`;

  return {
    "vite.config.ts": `import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });
`,
    "tsconfig.json": `${JSON.stringify(
      {
        extends: "$app/tsconfig",
        include: ["src", "*"],
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      },
      null,
      2,
    )}\n`,
    "src/app.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`,
    "src/app.css": SITE_CSS,
    "src/lib/site.ts": site,
    "src/lib/server/graft.ts": `${reader}\n`,
    "src/lib/server/site.ts": serverSite,
    "src/routes/+layout.svelte": `<script lang="ts">
  import type { Snippet } from "svelte";
  import { LISTED, label } from "#lib/site.ts";
  import "../app.css";

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head><title>${options.name}</title></svelte:head>

<div class="site">
  <nav class="nav">
    <a href="/">${options.name}</a>
    {#each LISTED as collection (collection)}
      <a href="/{collection}">{label(collection)}</a>
    {/each}
  </nav>
  <main>{@render children()}</main>
</div>
`,
    "src/routes/+page.server.ts": `import { FEATURED } from "#lib/site.ts";
import { entries, findEntry } from "#lib/server/site.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => ({
  home: await findEntry("pages", "home"),
  featured: FEATURED ? await entries(FEATURED) : [],
});
`,
    "src/routes/+page.svelte": `<script lang="ts">
  import { MdxContent } from "@usegraft/sdk-sveltekit/mdx";
  import { FEATURED } from "#lib/site.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<h1>{data.home?.title ?? "Welcome"}</h1>
{#if data.home?.line}<p class="line">{data.home.line}</p>{/if}
{#if data.home}<MdxContent tree={data.home.body} />{/if}
{#if data.featured.length > 0}
  <ul class="list">
    {#each data.featured as item (item.slug)}
      <li>
        <a href="/{FEATURED}/{item.slug}">{item.title}</a>
        {#if item.line}<p>{item.line}</p>{/if}
      </li>
    {/each}
  </ul>
{/if}
`,
    "src/routes/[collection]/+page.server.ts": `import { error } from "@sveltejs/kit";
import { isCollection } from "#lib/site.ts";
import { entries } from "#lib/server/site.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  if (!isCollection(params.collection)) error(404, "No such collection");
  return { collection: params.collection, items: await entries(params.collection) };
};
`,
    "src/routes/[collection]/+page.svelte": `<script lang="ts">
  import { label } from "#lib/site.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<h1>{label(data.collection)}</h1>
<ul class="list">
  {#each data.items as item (item.slug)}
    <li>
      <a href="/{data.collection}/{item.slug}">{item.title}</a>
      {#if item.line}<p>{item.line}</p>{/if}
    </li>
  {/each}
</ul>
`,
    "src/routes/[collection]/[slug]/+page.server.ts": `import { error } from "@sveltejs/kit";
import { isCollection } from "#lib/site.ts";
import { findEntry } from "#lib/server/site.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  if (!isCollection(params.collection)) error(404, "No such collection");
  const item = await findEntry(params.collection, params.slug);
  if (!item) error(404, "No such page");
  return { item };
};
`,
    "src/routes/[collection]/[slug]/+page.svelte": `<script lang="ts">
  import { MdxContent } from "@usegraft/sdk-sveltekit/mdx";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<article>
  <h1>{data.item.title}</h1>
  {#if data.item.line}<p class="line">{data.item.line}</p>{/if}
  <MdxContent tree={data.item.body} />
</article>
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
  if (options.framework === "nuxt") Object.assign(files, nuxtFiles(options));
  if (options.framework === "sveltekit") {
    Object.assign(files, sveltekitFiles(options));
    if (options.index === "postgres") files["src/env.ts"] = SVELTEKIT_ENV;
  }
  return files;
}
