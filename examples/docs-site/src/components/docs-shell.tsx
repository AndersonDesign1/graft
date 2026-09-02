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
          title: (
            <span className="font-serif text-xl">
              graft<b style={{ color: "var(--mark)" }}>.</b> docs
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
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
