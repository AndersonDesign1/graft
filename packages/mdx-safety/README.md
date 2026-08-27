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

Prose, GFM and components with literal attributes are unaffected. Expressions, `import`, `export`, expression-valued attributes and `{...spread}` attributes are refused.

Source the checker cannot parse throws `UncheckableMdxError` rather than passing. That is deliberate: the renderer's parser is not this one, and the gap between two independently configured parsers is exactly where executable source would hide.

## Not a sanitiser

This refuses _executable_ constructs. It is not a general HTML sanitiser. If you render content from people you do not trust at all, put a sanitiser in front of it as well.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/mdx-safety/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/feat/core/SECURITY.md)
