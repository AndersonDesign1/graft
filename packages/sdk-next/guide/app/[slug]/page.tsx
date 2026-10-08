import { notFound } from "next/navigation";
import { MdxBody } from "@usegraft/sdk-next";
import { graft } from "@/lib/graft";

// Optional: build every page ahead of time.
export async function generateStaticParams() {
  const pages = await graft.listContent("pages");
  return pages.map((page) => ({ slug: page.slug }));
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await graft.getContent("pages", slug);
  if (!page) notFound();

  return (
    <article>
      <h1>{page.data.title}</h1>
      {page.data.tagline && <p>{page.data.tagline}</p>}
      <MdxBody source={page.body} />
    </article>
  );
}
