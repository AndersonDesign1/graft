/**
 * faqFields — optional structured FAQ list for a collection (owned code).
 *
 * Spread into a collection: `fields: { title: field.string(), ...faqFields }`.
 * Then in MDX: `<Faq items={/* from frontmatter faqs *\/} />` or pass
 * `doc.data.faqs` from the page component.
 */
import { field } from "@graft/core";

export const faqFields = {
  faqs: field.array({
    optional: true,
    description: "FAQ entries shown on the page (question + answer).",
    of: field.object({
      fields: {
        question: field.string({ description: "The question." }),
        answer: field.text({ description: "The answer (plain text or short prose)." }),
      },
    }),
  }),
};
