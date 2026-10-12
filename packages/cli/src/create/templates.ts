/**
 * What `graft create` can start a site from: each template is a schema (as the
 * graft.config.ts source it writes) and a few example documents that satisfy
 * it, so the first compile succeeds and Studio opens on something real.
 */

export type TemplateName = "blog" | "docs" | "shop" | "portfolio" | "blank";

export const TEMPLATE_NAMES: readonly TemplateName[] = [
  "blog",
  "docs",
  "shop",
  "portfolio",
  "blank",
];

export interface Template {
  name: TemplateName;
  /** One line for the question that offers it. */
  summary: string;
  /** Collection definitions, as graft.config.ts source (each an exported const). */
  collections: string;
  /** The names exported above, in the order the site lists them. */
  collectionNames: string[];
  /** The collection the home page lists, if any. */
  featured?: string;
  /** Example documents: path under content/ to file body. */
  documents: Record<string, string>;
}

const pages = `export const pages = defineCollection({
  name: "pages",
  description: "Standalone pages: the home page, about, contact.",
  fields: {
    title: field.string({ description: "The page's headline and browser title." }),
    tagline: field.string({ optional: true, description: "A short line under the headline." }),
  },
});`;

const page = (title: string, tagline: string, body: string): string =>
  `---\ntitle: ${title}\ntagline: ${tagline}\n---\n\n${body}\n`;

const TEMPLATES: Record<TemplateName, Template> = {
  blank: {
    name: "blank",
    summary: "One page to start from",
    collections: pages,
    collectionNames: ["pages"],
    documents: {
      "pages/home.mdx": page(
        "Welcome",
        "Your new site",
        "This is your home page. Change it in Studio, or edit `content/pages/home.mdx`.",
      ),
    },
  },
  blog: {
    name: "blog",
    summary: "Posts with dates and authors, and a few pages",
    collections: `${pages}

export const posts = defineCollection({
  name: "posts",
  description: "Blog posts, newest first.",
  fields: {
    title: field.string({ description: "The post's headline." }),
    summary: field.text({ description: "One or two sentences for lists and previews." }),
    date: field.datetime({ description: "When it was published." }),
    author: field.string({ optional: true, description: "Who wrote it." }),
  },
});`,
    collectionNames: ["posts", "pages"],
    featured: "posts",
    documents: {
      "pages/home.mdx": page(
        "Welcome",
        "Notes, news and stories",
        "This is your home page. The latest posts are listed below it.",
      ),
      "pages/about.mdx": page("About", "Who we are", "Tell visitors who you are and what you do."),
      "posts/hello-world.mdx": `---\ntitle: Hello, world\nsummary: The first post on the new site.\ndate: "2026-01-15T09:00:00.000Z"\nauthor: The team\n---\n\nThis is your first post. Write the next one in Studio.\n`,
      "posts/how-we-work.mdx": `---\ntitle: How we work\nsummary: A second post, so the list has two.\ndate: "2026-01-08T09:00:00.000Z"\nauthor: The team\n---\n\nPosts are listed newest first. Each one has its own page.\n`,
    },
  },
  docs: {
    name: "docs",
    summary: "Documentation pages in order",
    collections: `${pages}

export const docs = defineCollection({
  name: "docs",
  description: "Documentation, in reading order.",
  fields: {
    title: field.string({ description: "The page's title." }),
    description: field.text({ description: "What the page covers, in a sentence." }),
    order: field.number({ description: "Where it sits in the list: lower comes first." }),
  },
});`,
    collectionNames: ["docs", "pages"],
    featured: "docs",
    documents: {
      "pages/home.mdx": page(
        "Documentation",
        "Everything you need to get started",
        "Start with the first page below.",
      ),
      "docs/getting-started.mdx": `---\ntitle: Getting started\ndescription: The first steps, from nothing to working.\norder: 1\n---\n\n## Install\n\nDescribe how to begin here.\n`,
      "docs/next-steps.mdx": `---\ntitle: Next steps\ndescription: Where to go once the basics work.\norder: 2\n---\n\nAdd more pages in Studio. The order field decides where each one sits.\n`,
    },
  },
  shop: {
    name: "shop",
    summary: "Products or a menu, with prices",
    collections: `${pages}

export const products = defineCollection({
  name: "products",
  description: "What you sell: products, or the items on a menu.",
  fields: {
    title: field.string({ description: "The product's name." }),
    summary: field.text({ description: "A sentence that sells it." }),
    price: field.number({ description: "The price, in your currency." }),
    available: field.boolean({ description: "Whether it can be bought right now." }),
  },
});`,
    collectionNames: ["products", "pages"],
    featured: "products",
    documents: {
      "pages/home.mdx": page(
        "Welcome",
        "Made fresh every day",
        "Have a look at what we have today.",
      ),
      "products/sourdough-loaf.mdx": `---\ntitle: Sourdough loaf\nsummary: Slow-fermented, with a crackling crust.\nprice: 6.5\navailable: true\n---\n\nBaked every morning.\n`,
      "products/cinnamon-bun.mdx": `---\ntitle: Cinnamon bun\nsummary: Soft, sticky and spiced.\nprice: 3.75\navailable: true\n---\n\nBest while still warm.\n`,
    },
  },
  portfolio: {
    name: "portfolio",
    summary: "Projects you've worked on",
    collections: `${pages}

export const projects = defineCollection({
  name: "projects",
  description: "Work to show, newest first.",
  fields: {
    title: field.string({ description: "The project's name." }),
    summary: field.text({ description: "What it was, in a sentence or two." }),
    year: field.number({ description: "When it was finished." }),
    link: field.string({ optional: true, description: "Where people can see it." }),
  },
});`,
    collectionNames: ["projects", "pages"],
    featured: "projects",
    documents: {
      "pages/home.mdx": page("Hello", "Selected work", "A few things I've made recently."),
      "pages/about.mdx": page("About", "A little about me", "Tell visitors about yourself here."),
      "projects/first-project.mdx": `---\ntitle: First project\nsummary: A short description of the work and what it achieved.\nyear: 2025\n---\n\nTell the story of the project here.\n`,
    },
  },
};

export function templateFor(name: TemplateName): Template {
  return TEMPLATES[name];
}

export function isTemplateName(value: unknown): value is TemplateName {
  return typeof value === "string" && (TEMPLATE_NAMES as readonly string[]).includes(value);
}
