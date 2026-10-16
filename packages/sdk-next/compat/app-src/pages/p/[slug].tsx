// The Pages Router: the document is read and its body compiled in
// getStaticProps, on the server; the page renders the compiled body on both
// sides. Its browser bundle must carry neither the database nor the compiler.
import type { GetStaticPaths, GetStaticProps } from "next";
import { prepareMdx } from "@usegraft/sdk-next";
import { MdxContent } from "@usegraft/sdk-next/mdx";
import { graft } from "../../lib/graft";

interface Props {
  title: string;
  code: string;
}

export const getStaticPaths: GetStaticPaths = async () => ({ paths: [], fallback: "blocking" });

export const getStaticProps: GetStaticProps<Props, { slug: string }> = async ({ params }) => {
  const page = await graft.getContent("pages", params?.slug ?? "");
  if (!page) return { notFound: true };
  return {
    props: { title: page.data.title, code: await prepareMdx(page.body) },
    revalidate: 60,
  };
};

export default function Page({ title, code }: Props) {
  return (
    <article>
      <h1>{title}</h1>
      <MdxContent code={code} />
    </article>
  );
}
