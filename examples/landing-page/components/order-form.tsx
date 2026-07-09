"use client";

import { useState } from "react";

export interface CatalogProduct {
  slug: string;
  title: string;
  priceCents: number;
  currency: string;
}

/** Client form that posts to POST /api/fn/placeOrder. */
export function OrderForm({ products }: { products: CatalogProduct[] }) {
  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState(products[0]?.slug ?? "");
  const [qty, setQty] = useState(1);
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setMessage(null);
    try {
      const res = await fetch("/api/fn/placeOrder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          items: [{ productSlug: slug, qty }],
        }),
      });
      const json = (await res.json()) as {
        data?: { id: string; totalCents: number; status: string };
        message?: string;
        fix?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatus("error");
        setMessage(json.fix ?? json.message ?? json.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus("ok");
      setMessage(
        `Order ${json.data?.id} placed (${json.data?.status}) — total ${(json.data?.totalCents ?? 0) / 100} ${products.find((p) => p.slug === slug)?.currency ?? "USD"}`,
      );
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  if (products.length === 0) {
    return <p className="contact-note">No active products in the catalog yet.</p>;
  }

  return (
    <section className="contact order">
      <h2>Place an order</h2>
      <form className="contact form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Product
          <select value={slug} onChange={(e) => setSlug(e.target.value)} required>
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title} — {(p.priceCents / 100).toFixed(2)} {p.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input
            type="number"
            min={1}
            step={1}
            required
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </label>
        <button type="submit" disabled={status === "pending"}>
          {status === "pending" ? "Placing…" : "Place order"}
        </button>
      </form>
      {message ? (
        <p className={status === "error" ? "contact-error" : "contact-note"}>{message}</p>
      ) : null}
    </section>
  );
}
