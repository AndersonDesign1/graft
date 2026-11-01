---
"@usegraft/sdk-vue": patch
"@usegraft/mdx-safety": patch
"@usegraft/sdk-next": patch
"@usegraft/mcp": patch
---

Add `@usegraft/sdk-vue`, the Vue client. `createGraft({ endpoint, collections })`
reads over the content API with the same three typed reads as every other
adapter, and `createGraftComposables(graft)` gives `useContent`,
`useContentList` and `useContentSearch`, which report `data`, `error` and
`loading` as refs.

```ts
const { useContent, useContentSearch } = createGraftComposables(graft);

const post = useContent("posts", () => String(route.params.slug));
const hits = useContentSearch("docs", query);
```

Arguments can be plain values, refs or getters, so a read follows the route or a
search box. The previous answer clears the moment the arguments change, and an
answer that arrives after they changed, or after the component is gone, is
dropped. Like sdk-react's hooks, they are a binding, not a cache: in Nuxt,
`useAsyncData` around `graft.getContent` is what puts content in the
server-rendered HTML.

MDX renders the way the Next.js Pages Router does. `prepareMdx`, from its own
`@usegraft/sdk-vue/server` entry so the compiler never reaches a browser
bundle, checks the trust rule and compiles on the server. `MdxContent` renders
the result with your Vue components on the server and again when the page
hydrates. A component gets the content between its tags as its default slot.
Under restricted trust a `javascript:` link loses its URL, which matters more
here than in React 19: Vue renders such a link as it is.

The safe-URL and refuse-imports plugins move from `@usegraft/sdk-next` into
`@usegraft/mdx-safety`, exported as `rehypeSafeUrls`, `remarkRefuseModules`
and `isSafeUrl`, so both adapters share one copy. sdk-next behaves as before.

`list_packages` accepts `framework: "vue"`.
