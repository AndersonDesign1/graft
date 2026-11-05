---
"@usegraft/mdx-safety": minor
"@usegraft/sdk-react": minor
"@usegraft/sdk-astro": minor
"@usegraft/sdk-react-router": minor
"@usegraft/sdk-tanstack-start": minor
"@usegraft/sdk-sveltekit": patch
---

Astro, React Router and TanStack Start can render a document's MDX body. Before,
these adapters returned the body as source and left rendering to you. They now
use the renderer SvelteKit has: the body is parsed into plain data on the
server and never evaluated, so `{expressions}`, `import`, `export` and
scripting are refused under every trust level, and script URLs are dropped
unless trust is `"full"`.

```astro
---
import { MdxContent } from "@usegraft/sdk-astro/mdx";
---
<MdxContent source={page.body} components={{ Callout }} />
```

```tsx
// React Router: prepare in the loader, render on the page.
import { prepareMdx } from "@usegraft/sdk-react-router/server";
import { MdxContent } from "@usegraft/sdk-react-router/mdx";

return { body: prepareMdx(doc.body) };
<MdxContent tree={loaderData.body} components={{ Callout }} />;
```

TanStack Start has the same two entries, `@usegraft/sdk-tanstack-start/server`
and `/mdx`. React's `MdxContent` lives in `@usegraft/sdk-react/mdx`, and
`prepareMdx` in `@usegraft/mdx-safety/prepare`, which `@usegraft/sdk-sveltekit/server`
now re-exports. Its API is unchanged. A refused body's message no longer says
"in Svelte", and a prepared table no longer keeps the whitespace between its
rows, which browsers drop and React reported as a hydration mismatch.
