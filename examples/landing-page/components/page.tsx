import Markdown from "react-markdown";
import type { Document } from "@graft/sdk-next";
import type { pages } from "@/graft.config";

/** Renders one `pages` document: typed frontmatter as the hero, MDX body below. */
export function Page({ doc }: { doc: Document<typeof pages> }) {
  return (
    <article>
      <h1>{doc.data.title}</h1>
      {doc.data.tagline ? <p className="tagline">{doc.data.tagline}</p> : null}
      <Markdown>{doc.body}</Markdown>
    </article>
  );
}
