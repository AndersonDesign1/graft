/**
 * FAQ, rendered from the live `home` document's `faqs` field — the landing
 * eats its own dogfood. Native <details> accordions with a rotating mark.
 */
export function LandingFaq({ items }: { items: Array<{ question: string; answer: string }> }) {
  return (
    <div className="faq-list">
      {items.map((item) => (
        <details key={item.question} className="faq-item">
          <summary>{item.question}</summary>
          <p className="faq-answer">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
