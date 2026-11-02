---
"@usegraft/sdk-sveltekit": minor
"@usegraft/mcp": patch
---

Render MDX in SvelteKit. `prepareMdx` from `@usegraft/sdk-sveltekit/server`
turns a body into a tree in a server `load`, and `MdxContent` from
`@usegraft/sdk-sveltekit/mdx` renders it with your Svelte components, on the
server and when the page hydrates:

```svelte
<MdxContent tree={data.body} components={{ Callout }} />
```

The body is never evaluated, so `{expressions}`, `import`, `export` and spread
attributes are refused under every trust level, along with `<script>`-like
elements, `on…` handlers and the `innerHTML`, `outerHTML` and
`dangerouslySetInnerHTML` attributes. Script URLs are dropped unless you pass
`{ trust: "full" }`. Svelte 5 is an optional peer, needed only for
`MdxContent`.

`list_packages` says the SvelteKit adapter renders MDX.
