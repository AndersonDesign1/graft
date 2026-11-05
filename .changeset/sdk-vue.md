---
"@usegraft/sdk-vue": minor
"@usegraft/mdx-safety": minor
"@usegraft/sdk-next": minor
"@usegraft/mcp": minor
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
and `isSafeUrl`, so both adapters share one copy.

**BREAKING:** restricted trust now also refuses `innerHTML`, `outerHTML` and
`dangerouslySetInnerHTML` attributes, in any case, on every framework. Vue renders
`<div innerHTML="<img src=x onerror=…>">` as raw HTML, so this was a working
script with no `{}` and no `on…` attribute for the existing checks to see.
React ignores the string form, which is why it went unnoticed while React was
the only renderer. The rule lives in `@usegraft/mdx-safety`, so `graft compile`,
MCP writes and Studio refuse such a body too. A body that used one of these
attributes under restricted trust now fails with `INPUT_VALIDATION_FAILED`; it
renders nothing useful in React anyway.

`list_packages` accepts `framework: "vue"`, and lists sdk-vue for static
projects as well, since the content API serves either index.
