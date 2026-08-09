/**
 * commerce — catalog + orders foundation (owned code; edit freely).
 *
 * products  — file-authoritative: author MDX under content/products/*.mdx
 * orders    — db-authoritative: rows in Postgres via the functions below
 *
 * Wired via the graft/ barrel — live on the next `graft compile`.
 * See graft/commerce.llms.txt for the agent flow.
 */
import { requireScopes } from "@usegraft/auth";
import { GraftError } from "@usegraft/contracts";
import {
  defineCollection,
  defineFunction,
  deleteRecord,
  field,
  insertRecord,
  listRecords,
  updateRecord,
  type FunctionContext,
} from "@usegraft/core";

/** Scopes this vertical checks — point them at whatever your issuer emits. */
export const COMMERCE_SCOPES = {
  ordersRead: "commerce:orders:read",
  ordersWrite: "commerce:orders:write",
} as const;

const requireOrdersRead = requireScopes(COMMERCE_SCOPES.ordersRead);
const requireOrdersWrite = requireScopes(COMMERCE_SCOPES.ordersWrite);

export const ORDER_STATUSES = ["pending", "paid", "cancelled", "fulfilled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * products — catalog as files. Agents author content/products/<slug>.mdx;
 * git is the version history. Compile projects into content_index.
 */
export const products = defineCollection({
  name: "products",
  description: "Sellable catalog items (file-authoritative). Author under content/products/.",
  fields: {
    title: field.string({ description: "Product name." }),
    description: field.text({ description: "Short product description." }),
    priceCents: field.number({ description: "Price in the smallest currency unit (e.g. cents)." }),
    currency: field.string({
      optional: true,
      description: 'ISO currency code (default "USD").',
    }),
    image: field.asset({ optional: true, description: "Product image." }),
    active: field.boolean({
      optional: true,
      description: "When false, placeOrder rejects this product. Default true when omitted.",
    }),
  },
});

/**
 * orders — operational data. Written only through placeOrder / updateOrderStatus /
 * cancelOrder. No content/orders/ folder (AUTHORITY_MISMATCH if files appear).
 */
export const orders = defineCollection({
  name: "orders",
  authority: "db-authoritative",
  description: "Customer orders. Place via placeOrder; admin via list/update/cancel.",
  fields: {
    email: field.string({ description: "Buyer email." }),
    items: field.array({
      description: "Line items snapshotted at order time (price locked).",
      of: field.object({
        fields: {
          productSlug: field.string({ description: "Catalog product slug." }),
          qty: field.number({ description: "Quantity (>= 1)." }),
          unitPriceCents: field.number({ description: "Unit price at order time." }),
        },
      }),
    }),
    status: field.string({
      description: "pending | paid | cancelled | fulfilled",
    }),
    totalCents: field.number({ description: "Sum of qty * unitPriceCents." }),
  },
});

type ProductRow = {
  slug: string;
  title: string;
  priceCents: number;
  active: boolean;
};

/** Load product frontmatter from content_index for the current branch. */
async function loadProducts(
  ctx: Pick<FunctionContext, "db" | "branch">,
  slugs: string[],
): Promise<Map<string, ProductRow>> {
  const unique = [...new Set(slugs)];
  const out = new Map<string, ProductRow>();
  for (const slug of unique) {
    const row = await ctx.db.query.contentIndex.findFirst({
      where: (t, ops) =>
        ops.and(
          ops.eq(t.branchId, ctx.branch),
          ops.eq(t.collection, "products"),
          ops.eq(t.slug, slug),
          ops.eq(t.deleted, false),
        ),
    });
    if (!row) continue;
    const data = row.data as {
      title?: string;
      priceCents?: number;
      active?: boolean;
    };
    if (typeof data.priceCents !== "number" || typeof data.title !== "string") continue;
    out.set(slug, {
      slug,
      title: data.title,
      priceCents: data.priceCents,
      active: data.active !== false,
    });
  }
  return out;
}

/** Public: place an order against the live catalog (prices snapshotted). */
export const placeOrder = defineFunction({
  name: "placeOrder",
  kind: "mutation",
  public: true,
  rateLimit: { limit: 10, windowSeconds: 60 },
  description:
    "Place an order for active products. Snapshots unit prices; status starts as pending. 10/min per caller.",
  returns: "{ id: string; totalCents: number; status: string; receivedAt: string }",
  input: {
    email: field.string({ description: "Buyer email." }),
    items: field.array({
      description: "What to buy.",
      of: field.object({
        fields: {
          productSlug: field.string({ description: "Product slug from content/products/." }),
          qty: field.number({ description: "Quantity (>= 1)." }),
        },
      }),
    }),
  },
  handler: async (ctx) => {
    const { email, items } = ctx.input;
    if (items.length === 0) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: "placeOrder requires at least one line item.",
        fix: 'Send items: [{ "productSlug": "widget", "qty": 1 }]. List catalog slugs via listContent("products") or content/products/.',
        details: { issues: [{ path: "items", message: "must be non-empty" }] },
      });
    }
    for (const [i, line] of items.entries()) {
      if (!Number.isFinite(line.qty) || line.qty < 1 || !Number.isInteger(line.qty)) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `items[${i}].qty must be an integer >= 1.`,
          fix: "Use whole quantities of at least 1 per line.",
          details: { issues: [{ path: `items.${i}.qty`, message: "integer >= 1 required" }] },
        });
      }
    }

    const catalog = await loadProducts(
      ctx,
      items.map((l) => l.productSlug),
    );
    const snapshotted: { productSlug: string; qty: number; unitPriceCents: number }[] = [];
    let totalCents = 0;

    for (const [i, line] of items.entries()) {
      const product = catalog.get(line.productSlug);
      if (!product) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `Unknown product slug "${line.productSlug}".`,
          fix: `Author content/products/${line.productSlug}.mdx (or fix the slug), run graft compile, then retry.`,
          details: {
            issues: [{ path: `items.${i}.productSlug`, message: "product not found" }],
          },
        });
      }
      if (!product.active) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `Product "${line.productSlug}" is not active.`,
          fix: "Set active: true on that product (or omit active) and recompile.",
          details: {
            issues: [{ path: `items.${i}.productSlug`, message: "product inactive" }],
          },
        });
      }
      snapshotted.push({
        productSlug: line.productSlug,
        qty: line.qty,
        unitPriceCents: product.priceCents,
      });
      totalCents += product.priceCents * line.qty;
    }

    const record = await insertRecord(ctx, orders, {
      email,
      items: snapshotted,
      status: "pending",
      totalCents,
    });
    return {
      id: record.id,
      totalCents: record.data.totalCents,
      status: record.data.status,
      receivedAt: record.createdAt.toISOString(),
    };
  },
});

/** Scope-gated: list recent orders, newest first. */
export const listOrders = defineFunction({
  name: "listOrders",
  kind: "query",
  description: "List recent orders, newest first. Requires commerce:orders:read.",
  returns: "{ orders: { id, email, status, totalCents, items, receivedAt }[] }",
  input: {
    limit: field.number({ optional: true, description: "Max rows (default 50)." }),
  },
  access: requireOrdersRead,
  handler: async (ctx) => {
    const records = await listRecords(ctx, orders, { limit: ctx.input.limit });
    return {
      orders: records.map((r) => ({
        id: r.id,
        email: r.data.email,
        status: r.data.status,
        totalCents: r.data.totalCents,
        items: r.data.items,
        receivedAt: r.createdAt.toISOString(),
      })),
    };
  },
});

/** Scope-gated: update order status (no payment provider — status only). */
export const updateOrderStatus = defineFunction({
  name: "updateOrderStatus",
  kind: "mutation",
  description:
    "Set an order's status (pending|paid|cancelled|fulfilled). Requires commerce:orders:write.",
  returns: "{ id: string; status: string }",
  input: {
    id: field.string({ description: "Order row id (uuid)." }),
    status: field.string({ description: "pending | paid | cancelled | fulfilled" }),
  },
  access: requireOrdersWrite,
  handler: async (ctx) => {
    const status = ctx.input.status as OrderStatus;
    if (!ORDER_STATUSES.includes(status)) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: `Invalid status "${ctx.input.status}".`,
        fix: `Use one of: ${ORDER_STATUSES.join(", ")}.`,
        details: {
          issues: [{ path: "status", message: `expected one of ${ORDER_STATUSES.join("|")}` }],
        },
      });
    }
    const record = await updateRecord(ctx, orders, ctx.input.id, { status });
    return { id: record.id, status: record.data.status };
  },
});

/**
 * Destructive + scope-gated: permanently delete an order (human-gated).
 * Soft-cancel = updateOrderStatus → cancelled; this is the hard-delete gate demo.
 */
export const cancelOrder = defineFunction({
  name: "cancelOrder",
  kind: "mutation",
  destructive: true,
  description:
    "Permanently delete an order. Destructive: requires human approval (graft approve) and commerce:orders:write.",
  returns: "{ deleted: { id: string; email: string } }",
  input: { id: field.string({ description: "Order row id (uuid)." }) },
  access: requireOrdersWrite,
  handler: async (ctx) => {
    const removed = await deleteRecord(ctx, orders, ctx.input.id);
    return { deleted: { id: removed.id, email: removed.data.email } };
  },
});

export const collections = { products, orders };
export const functions = { placeOrder, listOrders, updateOrderStatus, cancelOrder };
