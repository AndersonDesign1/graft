/**
 * The Fumadocs shell as one React island: RootProvider (Astro adapter) +
 * DocsLayout + DocsPage. The page tree and TOC are computed server-side from
 * Graft's content_index and passed in as serializable props; the MDX body
 * arrives as pre-rendered static HTML through the Astro slot.
 */
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import type { TOCItemType } from "fumadocs-core/toc";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import { type ReactNode, useState } from "react";
import { PoweredByGraft } from "./powered-by-graft";
import SearchDialog from "./search";

const REPO = "https://github.com/AndersonDesign1/graft";

/**
 * Where a page's words live. Every doc is an MDX file, except the error
 * reference, which is generated from the error registry. Pointing its edit
 * link at the generated file would invite an edit the next regeneration erases.
 */
function sourcePath(slug: string): string {
  return slug === "errors"
    ? "packages/mcp/src/explain.ts"
    : `examples/docs-site/content/docs/${slug}.mdx`;
}

/**
 * Copy as Markdown, view the Markdown, edit on GitHub, report a problem.
 * Edits open against feat/core, the branch every change lands on.
 */
function DocActions({ slug, title }: { slug: string; title: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const markdownHref = `/docs/${slug}.md`;

  async function copyMarkdown() {
    try {
      const response = await fetch(markdownHref);
      if (!response.ok) throw new Error(String(response.status));
      await navigator.clipboard.writeText(await response.text());
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }

  const issue = new URL(`${REPO}/issues/new`);
  issue.searchParams.set("title", `Docs: ${title}`);
  issue.searchParams.set(
    "body",
    `Page: https://graft.page/docs/${slug}

What is wrong or missing:
`,
  );

  return (
    <div className="doc-actions">
      <button type="button" onClick={copyMarkdown} aria-live="polite" data-state={copied}>
        {copied === "done" && (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.5 8.5l3 3 6-7"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy as Markdown"}
      </button>
      <a href={markdownHref}>View as Markdown</a>
      <a href={`${REPO}/edit/feat/core/${sourcePath(slug)}`} target="_blank" rel="noreferrer">
        Edit this page
      </a>
      <a href={issue.href} target="_blank" rel="noreferrer">
        Report a problem
      </a>
    </div>
  );
}

export function DocsShell({
  tree,
  pathname,
  params,
  toc,
  title,
  slug,
  section,
  lede,
  minutes,
  children,
}: {
  tree: Root;
  pathname: string;
  params: AstroProviderProps["params"];
  toc: TOCItemType[];
  title: string;
  slug: string;
  /** Sidebar group the page belongs to, shown above the title. */
  section: string;
  /** The page's kicker as HTML, lifted out of the body to sit under the title. */
  lede?: string;
  /** Estimated reading time, in whole minutes. */
  minutes: number;
  children: ReactNode;
}) {
  return (
    <RootProvider
      pathname={pathname}
      params={params}
      theme={{ enabled: false }}
      search={{ SearchDialog }}
    >
      <DocsLayout
        tree={tree}
        themeSwitch={{ enabled: false }}
        nav={{
          mode: "top",
          // A span, not a link like its counterpart on the landing: fumadocs
          // wraps this whole title in its own <a href={url}>, and an anchor
          // inside an anchor is invalid. The explanation lives one click away
          // on getting-started, which the badge sits next to in the sidebar
          // anyway.
          title: (
            <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
              <span className="font-serif text-lg md:text-xl">
                graft<b style={{ color: "var(--mark)" }}>.</b> docs
              </span>
              <span
                className="self-center rounded px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider"
                style={{
                  color: "var(--mark)",
                  border: "1px solid color-mix(in oklch, var(--mark) 35%, transparent)",
                  background: "color-mix(in oklch, var(--mark) 10%, transparent)",
                }}
              >
                beta
              </span>
            </span>
          ),
          // The wordmark reads "graft. docs", so it goes to the docs index —
          // clicking the name of where you are should not eject you from it.
          // Leaving the site is what the Home link below is for, and having
          // both means neither has to be guessed at.
          url: "/docs",
        }}
        links={[
          { text: "Home", url: "/", active: "none" },
          { text: "Why", url: "/why", active: "none" },
          { text: "Security", url: "/security", active: "none" },
        ]}
        githubUrl="https://github.com/AndersonDesign1/graft"
      >
        <DocsPage toc={toc}>
          <header className="doc-header">
            <p className="doc-eyebrow">
              <span>{section}</span>
              <span aria-hidden="true">·</span>
              <span>{minutes} min read</span>
            </p>
            <DocsTitle>{title}</DocsTitle>
            {/* The lede is the page's kicker, rendered from the repository's own
                MDX at build time, so it is trusted HTML (inline code, links). */}
            {lede && <p className="doc-lede" dangerouslySetInnerHTML={{ __html: lede }} />}
            <DocActions slug={slug} title={title} />
          </header>
          <DocsBody>{children}</DocsBody>
          <div className="powered-by-graft-docs">
            <PoweredByGraft />
          </div>
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
