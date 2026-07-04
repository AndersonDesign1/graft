import Markdown from "react-markdown";
import type { Document } from "@graft/sdk-next";
import type { pages } from "@/graft.config";
import { assetUrl } from "@/lib/assets";

/** Renders one `pages` document: typed frontmatter as the hero, MDX body below. */
export async function Page({ doc }: { doc: Document<typeof pages> }) {
  const image = doc.data.image;
  const imageSrc = image ? await assetUrl(image) : null;

  return (
    <article>
      <h1>{doc.data.title}</h1>
      {doc.data.tagline ? <p className="tagline">{doc.data.tagline}</p> : null}
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- presigned URLs are remote + short-lived; next/image gains nothing here
        <img className="hero" src={imageSrc} alt={image?.alt ?? ""} width={1200} height={400} />
      ) : null}
      <Markdown>{doc.body}</Markdown>
    </article>
  );
}
