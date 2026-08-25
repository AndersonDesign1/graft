# [HIGH] Arbitrary file write outside the content directory via unvalidated slug on PUT /api/studio/v1/document

**File:** [`packages/studio/src/api.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/api.ts#L650-L686) (lines 650, 659, 680, 686)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `path-traversal`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The PUT /document handler validates only that payload.collection and payload.slug are non-empty (L659-664) and forwards them to writeDocument(), which builds the target path as `${collection}/${slug}.mdx` joined onto contentDir (packages/studio/src/content.ts L101-103): `join(contentDir, ...sourcePath.split("/"))`. Unlike every git-facing path in this package, no safeContentPath()/containment check is applied, so a slug like `../../../../tmp/evil` or `../../src/payload` resolves outside the content root; writeDocumentFile() then does mkdirSync(dirname, {recursive:true}) + writeFileSync — an arbitrary file write (forced .mdx extension) anywhere the process can write, plus arbitrary directory creation. The only slug validation in the codebase (SLUG_RE kebab-case check, packages/compiler/src/parse.ts L60-70) does not stop this: parseDocument derives the checked slug via basename(sourcePath), which strips all traversal segments ('pwn.mdx' -> 'pwn' passes), and in the Studio flow the frontmatter `slug` field comes from attacker-controlled payload.data with no consistency check against the path slug (unlike MCP write_content's conflict check). Any caller able to reach this endpoint (loopback callers, any authenticated actor on hosted deployments per the acl finding, or local malware) gains a write primitive outside the sanctioned content tree — e.g. overwriting other .mdx sources in the monorepo or planting files that a later build step consumes.

## Recommendation

Run payload.slug (and collection) through the existing safeContentPath()-style containment check plus SLUG_RE validation BEFORE constructing the path in writeDocument(); reject slugs containing '/', '\\', '..' or anything outside ^[a-z0-9-]+$.

## Revalidation

**Verdict:** true-positive

Confirmed arbitrary write. The PUT /api/studio/v1/document handler validates only non-empty collection/slug (api.ts L659-664) and forwards to writeDocument(), which builds `sourcePath = ${collection}/${slug}.mdx` and `fullPath = join(contentDir, ...sourcePath.split("/"))` (content.ts L101-103) with no safeContentPath()/containment call anywhere in the flow — unlike git.ts's diff/commit paths, which do confine. A slug like '../../../../tmp/pwn' collapses under join() to a path outside the content root, and writeDocumentFile() (compiler/src/serialize.ts L31-36) does mkdirSync(recursive) + writeFileSync. The pre-write parseDocument() check does not save it: the SLUG_RE kebab-case validation (compiler/src/parse.ts L60-70) applies to the slug derived from frontmatter or basename(sourcePath) — basename strips all '..' segments ('pwn' passes) — and is entirely decoupled from the path actually written; there is no MCP-style frontmatter-slug-vs-path-slug conflict check here either (verified server.ts L665-670 has one; studio's writeDocument does not). Attacker data just needs to satisfy the collection's Zod schema, which they control. Reachability: unauthenticated on loopback mounts (authorize undefined per serve.ts/studio.ts) and any non-anonymous actor on hosted serve --studio per F1. True positive, HIGH is appropriate.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
