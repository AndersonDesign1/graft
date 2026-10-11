# Docs change

The reader follows the page and it works. Every command on it has been run.

1. Load `graft-writing` and read `references/docs-pages.md`.
2. Open the nearest page of the same kind and copy its structure.
3. Write or edit the page in `examples/docs-site/content/docs/`.
4. **Run every command and code sample** on the page in a `graft-verify`
   sandbox. Paste the real output where the page shows output. Fix the page,
   or the product, when they disagree.
5. Check the facts against source: versions, flags, error codes, tool names.
6. Run `pnpm --filter docs-site test`, `pnpm check:site`, and
   `pnpm check:error-docs`.
7. Render the page with `graft-verify` (docs-site feature) at 1440px and
   390px, and read its `.md` twin.
8. No changeset for a docs-only change.
9. Run [opening-a-pr](opening-a-pr.md).

**Reply:** what a reader can now do, the commands you ran and their output,
and anything in the product the docs exposed as wrong.
