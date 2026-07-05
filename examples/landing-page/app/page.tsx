import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contact-form";
import { Page } from "@/components/page";
import { getGraft } from "@/lib/graft";

export const dynamic = "force-dynamic";

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
