---
"@usegraft/sdk-next": minor
"@usegraft/mcp": patch
---

`@usegraft/sdk-next` runs on Next.js 14.2 and later, and in the Pages Router as well as the App Router. The peer ranges are now `next@^14.2.0 || ^15.0.0 || ^16.0.0` and `react@^18.2.0 || ^19.0.0`.

- **The Pages Router.** Read in `getStaticProps` or `getServerSideProps` as before. `prepareMdx(body)` compiles a body there, with the same trust rule as `MdxBody`, and `MdxContent` renders the result in the server render and in the browser. It comes from a new entry, `@usegraft/sdk-next/mdx`, that carries no server code. A body that uses `import` is refused with `INPUT_VALIDATION_FAILED`, since the browser has no bundler to resolve it.
- **React 18.** `createGraft` uses `React.cache` where React has it, and reads straight through where it does not, as in the Pages Router on Next.js 14.
- **Next.js 14.** `withGraft` writes `experimental.serverComponentsExternalPackages` there, the name 14 reads, and `serverExternalPackages` on 15 and later. The adapter imports `next/cache.js`, which Node's own loader can resolve when the Pages Router loads it unbundled.
- **Advisories.** Releases with open critical Next.js advisories are no longer refused at install. `withGraft` prints one warning naming the release to upgrade to: any 14, 15 before 15.5.24, or 16 before 16.3.3. Next.js 14 gets no more security fixes. Its last release, 14.2.35, is affected by 23 published advisories, two of them critical remote code execution, and each is fixed only in 15 and 16. Support for 14.2 is there so you can adopt Graft before you upgrade.

CI now builds and serves a real Next.js 14.2.35 app beside 15 and 16, and on each checks a Pages Router page and that none of the scripts it sends to the browser carries the database, the index or the MDX compiler. The Next.js guide has a version table and a section on the Pages Router.
