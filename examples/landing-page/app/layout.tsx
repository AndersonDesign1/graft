import type { Metadata } from "next";
import Link from "next/link";
import { getGraft } from "@/lib/graft";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Graft", template: "%s · Graft" },
  description: "The agent-first CMS — content as code, rendered live from the content index.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pages = await getGraft().listContent("pages");
  const nav = pages.sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99));

  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <span className="brand">graft</span>
            {nav.map((page) => (
              <Link key={page.slug} href={page.slug === "home" ? "/" : `/${page.slug}`}>
                {page.data.title}
              </Link>
            ))}
            <Link href="/products">Catalog</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Rendered from <code>content_index</code> — authored as MDX, versioned by git.
        </footer>
      </body>
    </html>
  );
}
