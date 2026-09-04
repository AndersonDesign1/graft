/**
 * The Fumadocs shell as one React island: RootProvider (Astro adapter) +
 * DocsLayout + DocsPage. The page tree and TOC are computed server-side from
 * Graft's content_index and passed in as serializable props; the MDX body
 * arrives as pre-rendered static HTML through the Astro slot.
 */
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import type { TOCItemType } from "fumadocs-core/toc";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";
import { PoweredByGraft } from "./powered-by-graft";
import SearchDialog from "./search";

export function DocsShell({
  tree,
  pathname,
  params,
  toc,
  title,
  description,
  children,
}: {
  tree: Root;
  pathname: string;
  params: AstroProviderProps["params"];
  toc: TOCItemType[];
  title: string;
  description?: string;
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
          // A span, not a link like its counterpart on the landing: fumadocs
          // wraps this whole title in its own <a href={url}>, and an anchor
          // inside an anchor is invalid. The explanation lives one click away
          // on getting-started, which the badge sits next to in the sidebar
          // anyway.
          title: (
            <span className="inline-flex items-baseline gap-2">
              <span className="font-serif text-xl">
                graft<b style={{ color: "var(--mark)" }}>.</b> docs
              </span>
              <span
                className="self-center rounded px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider"
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
          <DocsTitle>{title}</DocsTitle>
          {description ? <DocsDescription>{description}</DocsDescription> : null}
          <DocsBody>{children}</DocsBody>
          <div className="powered-by-graft-docs">
            <PoweredByGraft />
          </div>
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
