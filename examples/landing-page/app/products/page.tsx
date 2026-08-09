import type { Metadata } from "next";
import { MdxBody } from "@usegraft/sdk-next";
import { OrderForm } from "@/components/order-form";
import { mdxComponents } from "@/components/mdx-components";
import { getGraft } from "@/lib/graft";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalog",
  description: "Graft product catalog — file-authoritative products, orders in Postgres.",
};

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return "Custom / free";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function ProductsPage() {
  const docs = await getGraft().listContent("products");
  const products = docs
    .filter((d) => d.data.active !== false)
    .sort((a, b) => a.data.title.localeCompare(b.data.title));

  return (
    <article>
      <h1>Catalog</h1>
      <p className="tagline">
        Products are MDX under <code>content/products/</code>. Orders land in Postgres via{" "}
        <code>placeOrder</code>.
      </p>
      <ul className="product-list">
        {products.map((p) => (
          <li key={p.slug} className="product-card">
            <h2>{p.data.title}</h2>
            <p className="product-price">
              {formatPrice(p.data.priceCents, p.data.currency ?? "USD")}
            </p>
            <p className="product-desc">{p.data.description}</p>
            {p.body.trim() ? (
              <div className="mdx-body">
                <MdxBody source={p.body} components={mdxComponents} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <OrderForm
        products={products.map((p) => ({
          slug: p.slug,
          title: p.data.title,
          priceCents: p.data.priceCents,
          currency: p.data.currency ?? "USD",
        }))}
      />
    </article>
  );
}
