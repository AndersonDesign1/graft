import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contact-form";
import { Page } from "@/components/page";
import { getGraft } from "@/lib/graft";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getGraft().getContent("pages", "home");
  return doc ? { title: doc.data.title, description: doc.data.description } : {};
}

export default async function Home() {
  const doc = await getGraft().getContent("pages", "home");
  if (!doc) notFound();
  return (
    <>
      <Page doc={doc} />
      <ContactForm />
    </>
  );
}
