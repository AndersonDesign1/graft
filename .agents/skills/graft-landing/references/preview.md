# Preview before anything is pushed

The user wants to open the page before it reaches GitHub. A screenshot is
not a preview.

## Build it

```sh
O=.agents/skills/graft-verify/scripts/offline.sh
$O pnpm -r --filter 'docs-site^...' run build   # includes Studio
$O pnpm --filter docs-site build                 # runs scripts/studio-demo.mjs first
git checkout examples/docs-site/.graft/index.db  # the build restamps it
```

`examples/docs-site/scripts/studio-demo.mjs` copies the Studio bundle into
`public/studio-demo` with the recorded API responses. Re-record them with
`scripts/record-studio.cjs` against a real `graft studio` on a copy of the
content when Studio's API or the content changes, then gzip the result to
`src/studio-demo/fixtures.json.gz`.

## Make it portable and publish it

The built pages use absolute paths. `scripts/pack-preview.mjs` copies the
`/lab` pages and their assets to a folder with every path made relative:

```sh
node .agents/skills/graft-landing/scripts/pack-preview.mjs \
  examples/docs-site/.vercel/output/static <scratchpad>/artifact/site
```

Test that folder from a nested path before publishing it (serve it under
`/nested/deep/` and load a page: fonts, the live Studio, and the links in
the preview bar must all work with no failed request).

Publish with the Artifact tool: a small launcher page as the page itself,
with the preview pages in a frame and plain links to each as a fallback, and
everything else as supporting files. What the host refuses:

- A file or folder whose name starts with `_`. Astro's `_astro` is renamed
  to `site-assets` by the pack script.
- A text file containing U+FFFD. Studio's editor bundle has one inside a
  template literal; write it as the escape `�` in the copy.
- More than 255 files in one publish. Send the site first, then Studio, and
  only the Studio chunks it needs at start.

Later publishes send only the files that changed.

## Then stop

- Commit locally with a message that follows `graft-writing`.
- Do not push. A stop hook will ask for the push; the user's request to see
  it first outranks the hook. Say that the commit is local and that a
  restarted container can lose it, and push when they say "push".
- Say plainly what you could not check, such as the hosted link itself.
