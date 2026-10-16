import type { GetStaticPaths, GetStaticProps } from "next";
import { prepareMdx } from "@usegraft/sdk-next";
import { MdxContent } from "@usegraft/sdk-next/mdx";
import { graft } from "@/lib/graft";

interface Props {
  title: string;
  tagline: string | null;
  code: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const pages = await graft.listContent("pages");
  return {
    paths: pages.map((page) => ({ params: { slug: page.slug } })),
    fallback: "blocking",
  };
};

export const getStaticProps: GetStaticProps<Props, { slug: string }> = async ({ params }) => {
  const page = await graft.getContent("pages", params?.slug ?? "");
  if (!page) return { notFound: true };

  return {
    props: {
      title: page.data.title,
      tagline: page.data.tagline ?? null,
      code: await prepareMdx(page.body),
    },
  };
};

export default function Page({ title, tagline, code }: Props) {
  return (
    <article>
      <h1>{title}</h1>
      {tagline && <p>{tagline}</p>}
      <MdxContent code={code} />
    </article>
  );
}
