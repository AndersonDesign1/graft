import { notFound } from "next/navigation";
import { MdxBody } from "@usegraft/sdk-next";
import { graft } from "../../lib/graft";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await graft.getContent("pages", slug);
  // A second read of the same document in the same render. React.cache
  // should hand back the very same object.
  const again = await graft.getContent("pages", slug);
  if (!page) notFound();

  return (
    <article>
      <h1>{page.data.title}</h1>
      <p id="deduped">deduped:{String(page === again)}</p>
      <MdxBody source={page.body} />
    </article>
  );
}
