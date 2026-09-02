/**
 * The MDX component map, exercised through the real render pipeline.
 *
 * These go through `renderMdx`, not through React directly, because the thing
 * most likely to break is not the component — it is whether an authored body
 * can actually reach it. MDX only treats a JSX block as one element when
 * nothing shares its opening line, the safety gate refuses `{expressions}` in
 * attributes, and both failures look like prose rendering as angle brackets
 * rather than like an error.
 */
import { describe, expect, it } from "vitest";
import { assertSafeMdx } from "@usegraft/mdx-safety";
import { renderMdx } from "./mdx";

/** Render the way a compiled document would, gate included. */
async function render(body: string): Promise<string> {
  assertSafeMdx(body, { label: "test" });
  return renderMdx(body);
}

describe("Tabs", () => {
  const body = [
    '<Tabs labels="npm, pnpm">',
    "",
    "<Tab>",
    "",
    "`npm i`",
    "",
    "</Tab>",
    "",
    "<Tab>",
    "",
    "`pnpm add`",
    "",
    "</Tab>",
    "",
    "</Tabs>",
  ].join("\n");

  // The first render in this file pays shiki's grammar and theme load, so this
  // case carries the cost for the whole suite: real work, not a hang. The 5s
  // default was always marginal here and vitest 3 tipped it over. Raised on
  // this case alone rather than globally, so a test that really does hang
  // still fails in five seconds.
  const SHIKI_WARMUP_MS = 30_000;

  it(
    "renders a label and a panel per tab",
    async () => {
      const html = await render(body);

      expect(html.match(/class="tab-label"/g)).toHaveLength(2);
      expect(html.match(/class="tab-panel"/g)).toHaveLength(2);
      expect(html).toContain(">npm<");
      expect(html).toContain(">pnpm<");
    },
    SHIKI_WARMUP_MS,
  );

  it("switches with radios, so the panel needs no JavaScript", async () => {
    const html = await render(body);

    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain("checked");
  });

  it("gives each group its own radio name, so two tab sets do not fight", async () => {
    const html = await render(`${body}\n\n${body}`);
    const names = [...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);

    expect(new Set(names).size).toBe(2);
  });

  it("renders nothing rather than a broken strip when labels are empty", async () => {
    const html = await render('<Tabs labels="">\n\n<Tab>\n\nx\n\n</Tab>\n\n</Tabs>');

    expect(html).not.toContain("tab-list");
  });

  it("takes the shorter side when the author miscounts", async () => {
    const html = await render('<Tabs labels="a, b, c">\n\n<Tab>\n\nonly one\n\n</Tab>\n\n</Tabs>');

    expect(html.match(/class="tab-panel"/g)).toHaveLength(1);
    expect(html.match(/class="tab-label"/g)).toHaveLength(1);
  });
});

describe("CodeBlock", () => {
  it("titles a fence without replacing it, so shiki still highlights", async () => {
    const html = await render(
      [
        '<CodeBlock title="graft.config.ts" note="static tier">',
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "</CodeBlock>",
      ].join("\n"),
    );

    expect(html).toContain("graft.config.ts");
    expect(html).toContain("static tier");
    // shiki ran: its class and its per-token CSS variables are both present.
    expect(html).toContain("shiki");
    expect(html).toContain("--shiki-light");
  });
});

describe("Steps", () => {
  it("numbers from a counter rather than from the author", async () => {
    const html = await render(
      [
        "<Steps>",
        "",
        '<Step title="Install">',
        "",
        "Run it.",
        "",
        "</Step>",
        "",
        '<Step title="Compile">',
        "",
        "Then this.",
        "",
        "</Step>",
        "",
        "</Steps>",
      ].join("\n"),
    );

    // No digits in the markup: the numbers come from CSS counters, so inserting
    // a step in the middle renumbers nothing by hand.
    expect(html).toContain('class="steps"');
    expect(html.match(/class="step"/g)).toHaveLength(2);
    expect(html).toContain("Install");
    expect(html).toContain("Compile");
  });
});

describe("TierBadge", () => {
  it("renders the tier's own wording", async () => {
    expect(await render('<TierBadge tier="postgres" />')).toContain("needs Postgres");
    expect(await render('<TierBadge tier="static" />')).toContain(">static<");
  });

  it("renders nothing for a tier that does not exist", async () => {
    // A badge asserting the wrong tier answers the reader's question
    // incorrectly, which is worse than not answering it.
    expect(await render('<TierBadge tier="mongo" />')).not.toContain("tier-badge");
  });
});

describe("FieldTable", () => {
  it("reads the live collection instead of a copy of it", async () => {
    const html = await render('<FieldTable collection="docs" />');

    // These are the docs collection's real fields in graft.config.ts. If one is
    // renamed, this test fails and so does the page — which is the point.
    expect(html).toContain("title");
    expect(html).toContain("description");
    expect(html).toContain("section");
    expect(html).toContain("order");
  });

  it("marks required and optional from the schema, not from prose", async () => {
    const html = await render('<FieldTable collection="docs" />');
    const rows = html.split("<tr").slice(2);
    const orderRow = rows.find((row) => row.includes(">order<"));
    const titleRow = rows.find((row) => row.includes(">title<"));

    // `order` is declared optional and `title` is not.
    expect(orderRow).not.toContain(">yes<");
    expect(titleRow).toContain(">yes<");
  });

  it("names the collections that exist when given one that does not", async () => {
    const html = await render('<FieldTable collection="nope" />');

    expect(html).toContain("No collection named");
    expect(html).toContain("docs");
  });
});
