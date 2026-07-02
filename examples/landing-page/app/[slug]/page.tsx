import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/components/page";
import { getGraft } from "@/lib/graft";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getGraft().getContent("pages", slug);
  return doc ? { title: doc.data.title, description: doc.data.tagline } : {};
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const doc = await getGraft().getContent("pages", slug);
  if (!doc) notFound();
  return <Page doc={doc} />;
}
