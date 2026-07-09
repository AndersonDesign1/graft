/**
 * Faq — MDX block (owned code; edit freely).
 *
 * Use in authored MDX bodies with an items prop:
 *
 *   <Faq items={[
 *     { question: "Is content in git?", answer: "Yes — git is authoritative." },
 *     { question: "Who is the primary operator?", answer: "An AI agent." },
 *   ]} />
 *
 * Or spread a frontmatter `faqs` array from a collection that uses `faqFields`.
 */
export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqProps {
  items?: FaqItem[];
  title?: string;
}

export function Faq({ items = [], title }: FaqProps) {
  if (items.length === 0) return null;
  return (
    <section className="faq" aria-label={title ?? "Frequently asked questions"}>
      {title ? <h2 className="faq-title">{title}</h2> : null}
      <dl className="faq-list">
        {items.map((item) => (
          <div key={item.question} className="faq-item">
            <dt className="faq-question">{item.question}</dt>
            <dd className="faq-answer">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
