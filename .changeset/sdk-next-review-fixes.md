---
"@usegraft/sdk-next": patch
---

Fixes from a review of the Next.js 14 and Pages Router support.

- **Unsafe URLs are dropped from restricted MDX.** `MdxBody` and `prepareMdx` remove any URL attribute whose scheme isn't `http`, `https`, `mailto` or `tel`, on Markdown links and on components. A `[Read more](javascript:…)` link rendered as a live link on React 18, which the Pages Router on Next.js 14 uses.
- **`prepareMdx` reads imports from the syntax tree.** A code span or fenced block that only mentions `await import(` is no longer refused. Under `trust: "full"`, `import()` and `import.meta` are refused too, instead of compiling to code that always throws.
- **`withGraft` merges both externals settings into the one this Next.js reads.** On 15 and later, a leftover `experimental.serverComponentsExternalPackages` no longer replaces `serverExternalPackages` and drops `@usegraft/registry`. On 14, a top-level `serverExternalPackages` is moved where 14 reads it.
- **`withGraft` finds Next.js from a monorepo's root.** When no `next` is installed beside the config, it uses the one this package resolves.
- **A prerelease of a patched release counts as before it,** so `16.3.3-canary.1` gets the upgrade warning.
- The `FRAMEWORK_VERSION_UNSUPPORTED` fix says `revalidateContent` works on Next.js 14, 15 and 16. The Next.js guide says `MdxContent` needs `'unsafe-eval'` in a Content Security Policy.
