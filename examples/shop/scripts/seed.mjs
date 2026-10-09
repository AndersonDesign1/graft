/**
 * Write a believable catalog into content/: categories, products and pages.
 *
 *   node scripts/seed.mjs              # 48 products (what is committed)
 *   node scripts/seed.mjs --count 2000 # a catalog to test Studio at scale
 *
 * Deterministic: the same count always writes the same bytes, so re-running
 * it on a clean checkout changes nothing.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../content/", import.meta.url).pathname;
const countArg = process.argv.indexOf("--count");
const count = countArg === -1 ? 48 : Number(process.argv[countArg + 1]);
if (!Number.isInteger(count) || count < 1) throw new Error("--count needs a whole number");

let state = 20261009;
const random = () => {
  state = (state * 1664525 + 1013904223) % 2 ** 32;
  return state / 2 ** 32;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const categories = [
  ["shirts", "Shirts", "Linen, cotton and flannel, cut to be worn for years.", 1],
  ["knitwear", "Knitwear", "Wool and cashmere from small mills.", 2],
  ["trousers", "Trousers", "Chinos, cords and work trousers.", 3],
  ["outerwear", "Outerwear", "Coats and jackets for real weather.", 4],
  ["accessories", "Accessories", "Hats, scarves, belts and bags.", 5],
  ["footwear", "Footwear", "Boots and shoes, resoleable.", 6],
];

const materials = [
  "Linen",
  "Merino",
  "Cotton",
  "Corduroy",
  "Waxed Cotton",
  "Cashmere",
  "Flannel",
  "Denim",
  "Canvas",
  "Suede",
];
const colors = ["Oat", "Ink", "Rust", "Olive", "Chalk", "Navy", "Moss", "Clay", "Charcoal", "Ecru"];
const nouns = {
  shirts: ["Shirt", "Overshirt", "Camp Shirt", "Oxford"],
  knitwear: ["Crewneck", "Cardigan", "Rollneck", "Vest"],
  trousers: ["Chino", "Work Trouser", "Cord Trouser", "Pleated Trouser"],
  outerwear: ["Chore Coat", "Field Jacket", "Parka", "Overcoat"],
  accessories: ["Beanie", "Scarf", "Tote", "Belt"],
  footwear: ["Derby", "Chukka", "Work Boot", "Loafer"],
};
const sizes = ["XS", "S", "M", "L", "XL"];

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const yamlString = (text) =>
  /^[\w .,'&-]+$/.test(text) && !/^\d/.test(text) ? text : JSON.stringify(text);

for (const dir of ["categories", "products", "pages"]) {
  rmSync(join(root, dir), { recursive: true, force: true });
  mkdirSync(join(root, dir), { recursive: true });
}

for (const [slug, title, description, order] of categories) {
  writeFileSync(
    join(root, "categories", `${slug}.mdx`),
    `---\ntitle: ${title}\ndescription: ${description}\norder: ${order}\n---\n`,
  );
}

const used = new Set();
const products = [];
for (let i = 0; products.length < count; i += 1) {
  const [category] = pick(categories);
  const title = `${pick(colors)} ${pick(materials)} ${pick(nouns[category])}`;
  let slug = slugify(title);
  if (used.has(slug)) slug = `${slug}-${i}`;
  used.add(slug);
  products.push({ slug, title, category });
}

products.forEach((product, i) => {
  const price = (Math.floor(random() * 30) + 3) * 500 - 100;
  const onSale = random() < 0.2;
  const status = random() < 0.1 ? "draft" : random() < 0.08 ? "archived" : "active";
  const variantSizes = product.category === "accessories" ? [] : sizes.filter(() => random() < 0.7);
  const code = product.slug
    .split("-")
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const lines = [
    "---",
    `title: ${yamlString(product.title)}`,
    `status: ${status}`,
    `price: ${price}`,
    ...(onSale ? [`compareAtPrice: ${price + 2000}`] : []),
    `category: ${product.category}`,
    `summary: ${yamlString(`A ${product.title.toLowerCase()} made to last, in a cut that works on its own or layered.`)}`,
    "images:",
    `  - key: products/${product.slug}/front.jpg`,
    `    alt: ${yamlString(`${product.title}, front`)}`,
    "tags:",
    `  - ${product.category}`,
    ...(onSale ? ["  - sale"] : []),
  ];
  if (variantSizes.length > 0) {
    lines.push("variants:");
    variantSizes.forEach((size) => {
      lines.push(
        `  - sku: ${code}-${i}-${size}`,
        `    size: ${size}`,
        `    stock: ${Math.floor(random() * 40)}`,
      );
    });
  }
  if (i % 7 === 0) lines.push("featured: true");
  const related = [products[(i + 1) % products.length], products[(i + 5) % products.length]]
    .filter((other) => other && other.slug !== product.slug)
    .map((other) => other.slug);
  if (related.length > 0) {
    lines.push("related:", ...related.map((slug) => `  - ${slug}`));
  }
  lines.push(
    "---",
    "",
    `The ${product.title.toLowerCase()} is cut from ${pick(["heavyweight", "midweight", "lightweight"])} cloth and finished by hand.`,
    "",
    "## Care",
    "",
    "- Wash cold, inside out",
    "- Dry flat",
    "- Press on a low heat",
    "",
  );
  writeFileSync(join(root, "products", `${product.slug}.mdx`), lines.join("\n"));
});

const pages = [
  ["about", "About the shop", "Who makes our clothes, and why we keep the range small."],
  ["shipping", "Shipping", "Delivery times and costs."],
  ["returns", "Returns", "Free returns within 30 days."],
];
for (const [slug, title, description] of pages) {
  writeFileSync(
    join(root, "pages", `${slug}.mdx`),
    `---\ntitle: ${title}\ndescription: ${description}\n---\n\n${description}\n`,
  );
}

console.log(
  `Wrote ${categories.length} categories, ${readdirSync(join(root, "products")).length} products and ${pages.length} pages.`,
);
