# The content inventory

Write this before any layout. It is the contract for the page.

## How to build it

1. Read the page being replaced, section by section, and list each heading
   with the claim under it. The landing page's old sections live in
   `examples/docs-site/src/components/landing/` and `src/pages/index.astro`.
2. Read `README.md` (the product in the maintainers' words), `CONTEXT.md`
   (the names of things) and the description line of every docs page:

   ```sh
   cd examples/docs-site
   grep -m1 '^description:' content/docs/*.mdx
   ```

3. For each section write four things: what it says, how the page proves it
   (the real thing shown), where the fact comes from, and which page owns the
   longer version.
4. Mark what the old page had that the new one drops. Ask before dropping it.

`examples/docs-site/src/pages/lab/map.astro` is the inventory for the landing
page, as a page the user can read. Update it when the landing page changes.

## What the landing page carries

In order: the hero, the agents it works with, the stack it fits, the two ways
in (agents and people), how it works, the editable file, typed reads, the
approval before a delete, branching, the two storage engines and where it
runs, owned primitives, the questions, and the close with one card for the
agent and one for the reader.

## What other pages own

| Page | Owns |
| --- | --- |
| Why `/why` | The argument for content as code, and who Graft is not for |
| Security `/security` | How the approval gate is enforced, audit, MDX safety, auth |
| Studio `/studio` | The editor in full: drafts, history, hosting, roles |
| Agents `/agents` | Every MCP tool, connecting a client, tokens and scopes |
| Self-hosting | Deploy shapes, branches and previews, hardening |
| Docs | Every how-to and reference |

A marketing page states a thing once, proves it, and links to its owner. It
does not explain.
