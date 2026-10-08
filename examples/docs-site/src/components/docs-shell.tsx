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
import { Check, Copy, FileText, History, MessageSquareWarning, SquarePen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { docSourcePath } from "../lib/doc-source";
import { AnthropicMark, OpenAIMark } from "./brand-icons";
import { PoweredByGraft } from "./powered-by-graft";
import SearchDialog from "./search";

const REPO = "https://github.com/AndersonDesign1/graft";
const SITE = "https://graft.page";

/** Icons in the page chrome: one size, one stroke, decorative to readers. */
const ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * Reading actions under the lede: take the page as Markdown, or hand it to an
 * assistant with a ready prompt. The prompt names the page's URL so the
 * assistant reads the current docs, not whatever it remembers about Graft.
 */
function DocActions({ slug }: { slug: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const markdownHref = `/docs/${slug}.md`;
  const prompt = `Read from this URL: ${SITE}/docs/${slug} and explain it to me.`;
  const chatgpt = `https://chatgpt.com/?${new URLSearchParams({ hints: "search", prompt })}`;
  const claude = `https://claude.ai/new?${new URLSearchParams({ q: prompt })}`;

  async function copyMarkdown() {
    try {
      const response = await fetch(markdownHref);
      if (!response.ok) throw new Error(String(response.status));
      await navigator.clipboard.writeText(await response.text());
      setCopied("done");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      // A failure stays until the next click, so it cannot be missed.
      setCopied("failed");
    }
  }

  return (
    <div className="doc-actions">
      <button type="button" onClick={copyMarkdown} aria-live="polite" data-state={copied}>
        {copied === "done" ? <Check {...ICON} /> : <Copy {...ICON} />}
        {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy page"}
      </button>
      <a href={markdownHref}>
        <FileText {...ICON} />
        View as Markdown
      </a>
      <a href={chatgpt} target="_blank" rel="noreferrer">
        <OpenAIMark width={14} height={14} />
        Open in ChatGPT
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={claude} target="_blank" rel="noreferrer">
        <AnthropicMark width={14} height={14} />
        Open in Claude
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

/** "Oct 8, 2026", the same on the server and in every reader's time zone. */
const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * When the page last changed, and the two ways to change it: edit the source,
 * or report what is wrong. Lives beside the contents on wide screens and at
 * the end of the article when the contents rail is hidden. Edits open
 * against feat/core, the branch every change lands on.
 */
function PageMeta({
  slug,
  title,
  updated,
  className,
}: {
  slug: string;
  title: string;
  updated?: string;
  className: string;
}) {
  const issue = new URL(`${REPO}/issues/new`);
  issue.searchParams.set("title", `Docs: ${title}`);
  issue.searchParams.set(
    "body",
    `Page: ${SITE}/docs/${slug}

What is wrong or missing:
`,
  );

  return (
    <div className={`doc-meta ${className}`}>
      {updated && (
        <p className="doc-meta-updated">
          <History {...ICON} />
          <span>
            Last updated <time dateTime={updated}>{DATE.format(new Date(updated))}</time>
          </span>
        </p>
      )}
      <a href={`${REPO}/edit/feat/core/${docSourcePath(slug)}`} target="_blank" rel="noreferrer">
        <SquarePen {...ICON} />
        Edit this page
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={issue.href} target="_blank" rel="noreferrer">
        <MessageSquareWarning {...ICON} />
        Report a problem
        <span className="sr-only"> (opens in a new tab)</span>
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
  updated,
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
  /** ISO date of the source's last commit, when git history is available. */
  updated?: string;
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
              <span className="wordmark-badge self-center rounded px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider">
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
        <DocsPage
          toc={toc}
          tableOfContent={{
            footer: (
              <PageMeta slug={slug} title={title} updated={updated} className="doc-meta-rail" />
            ),
          }}
        >
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
            <DocActions slug={slug} />
          </header>
          <DocsBody>{children}</DocsBody>
          <PageMeta slug={slug} title={title} updated={updated} className="doc-meta-end" />
          <div className="powered-by-graft-docs">
            <PoweredByGraft />
          </div>
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
