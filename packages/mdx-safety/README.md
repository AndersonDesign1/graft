# @usegraft/mdx-safety

> Refuse executable MDX before it is stored or rendered.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Why

MDX is code. `{expr}` evaluates JavaScript, `import` pulls modules in, and `@mdx-js/mdx`'s `run()` evaluates the compiled body with `new Function` in the host runtime, with full `process`, `fetch` and dynamic `import()`.

For content an operator wrote and reviewed in git, that is the feature. It stops being the feature the moment someone else can author a page: on shared infrastructure, one author's body reaches every other tenant.

## Install

```bash
npm i @usegraft/mdx-safety
```

## Use

```ts
import { assertSafeMdx, findExecutableMdx, type MdxTrust } from "@usegraft/mdx-safety";

// throw, with every offender named at once
assertSafeMdx(body, { label: "pages/home" });

// or collect them yourself
const found = findExecutableMdx(body);
```

Prose, GFM and components with literal attributes pass. Expressions, `import`, `export`, expression-valued attributes and `{...spread}` attributes are refused. So are elements that load or run code (`<script>`, `<iframe>` and the like), inline event handlers such as `onerror="…"`, and the raw-HTML attributes `innerHTML`, `outerHTML` and `dangerouslySetInnerHTML` in any case, even with a literal value: Vue renders `innerHTML="…"` as markup.

Source the checker cannot parse throws `UncheckableMdxError` rather than passing. That is deliberate: the renderer's parser is not this one, and the gap between two independently configured parsers is exactly where executable source would hide.

## Prepare a body for rendering

`prepareMdx`, from `@usegraft/mdx-safety/prepare`, parses a body into a tree of text, HTML elements and components that the Svelte, React and Astro adapters' `MdxContent` renders. (The Next.js and Vue adapters compile a body to code instead, with their own `prepareMdx`.) Nothing in it is evaluated, so it refuses expressions, `import`, `export` and spread attributes under every trust level, and drops script URLs unless `trust` is `"full"`.

```ts
import { prepareMdx } from "@usegraft/mdx-safety/prepare";

const tree = prepareMdx(body, { label: "pages/home" });
```

The tree's types, and the guard a renderer applies to a tree that did not come from `prepareMdx`, are in `@usegraft/mdx-safety/tree`, which has no dependencies and is safe in the browser. In an app, use the adapter's entries instead: `prepareMdx` from `@usegraft/sdk-sveltekit/server`, `@usegraft/sdk-react-router/server` or `@usegraft/sdk-tanstack-start/server`, and `MdxContent` from the same adapter's `/mdx`. Astro's `MdxContent`, from `@usegraft/sdk-astro/mdx`, takes the source and prepares it itself.

## Not a sanitiser

This refuses _executable_ constructs. It is not a general HTML sanitiser. If you render content from people you do not trust at all, put a sanitiser in front of it as well.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/mdx-safety/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/main/SECURITY.md)
