# Docs pages

How a page in `examples/docs-site/content/docs/` is built. Copy the shape of
an existing page of the same kind before writing a new one: `getting-started`
(tutorial), `the-model` (explanation), `branching-previews` (task guide),
`cli-reference` (reference).

## Frontmatter

```mdx
---
title: Branching & previews
description: "Preview content changes on a branch, show them to reviewers, then merge. Production stays untouched until you do."
section: Deploy & operate
order: 2
---
```

- `title`: the thing or the task, in sentence case, two to four words.
  "Getting started", "Branching & previews", "Rate limits".
- `description`: one or two sentences saying what the reader can do after
  reading. Used for search, social cards and `llms.txt`.
- `section` and `order` place the page in the sidebar. Sections are grouped by
  task: Get started, Frameworks, Content, Runtime data, Agents & MCP,
  Deploy & operate, Reference.

## The opening

Every page opens the same way:

1. **The promise**, one sentence, rendered as the lede. It says what the
   reader gets, not what the page contains:
   "Show reviewers a content change before it reaches production."
2. **The situation or the outcome**, a short paragraph. Task guides start
   with a concrete scenario ("You are redesigning the pricing page...").
   Tutorials list what the reader will do ("In this guide you will:").
   Explanations list the ideas the page covers.
3. **An agent prompt**, on any page that ends in a working result: the exact
   prompt that makes a coding agent do the page, pointing at the page's
   `.md` URL.

## Headings

- Guide headings name a task the reader does: "Create a branch and preview
  it", "Add your own content", "Connect your identity provider".
- Concept headings state the idea as a sentence: "Your files are the source
  of truth", "Content and user data are kept apart".
- A guide ends with "Next steps" (two to four links). A troubleshooting
  section, when a page has one, is an error table: code, meaning, fix.
- No headings like "Overview", "Introduction", "Details" or "Note".

## Steps

Use `<Steps>` only for an order the reader must follow.

- Each `<Step title>` is an imperative action: "Install the Next.js SDK and
  CLI", "Compile your content".
- A step is at most: one sentence of why or what, one code block, one
  sentence on what happened or what you should see.
- End a tutorial with a check the reader can make: "You should see the
  heading **Hello, Graft**."

## Code

- Every block that is a file has `<CodeBlock title="path/from/project/root">`.
- Shell blocks are `sh`, one command per line, no `$` in the source (a reader
  who copies it gets a broken command).
- Examples are complete enough to paste: imports included, no `...` in the
  middle of required code.
- Code is checked against the real packages. If a sample cannot be
  type-checked, say why in the PR.
- Use the real output in a following `text` block when it helps the reader
  confirm they are on track.

## Callouts

`<Callout label="..." type="warning">`, where `type` is one of `note`
(the default), `warning` or `danger`. At most two per page.

- The label is the point, as a sentence: "Deletes cannot be undone",
  "Keep the client on the server", "The rule". Not "Note" or "Warning".
- "Prefer to let your agent do it?" is reserved for the agent prompt on
  pages that do not have the dedicated block yet.
- Body is one to three sentences.

## Tables

- Use a table when the reader compares or looks something up: engines,
  frameworks and their packages, error codes, flags.
- Column headers say what the column holds: "Error code", "What it means",
  "What to do".
- Error tables always have those three columns, in that order.

## Words specific to Graft

| Say | Not |
| --- | --- |
| index (derived from your files) | database, cache, store (for the index) |
| compile, `graft compile` | build, sync, publish (for compiling) |
| static engine, Postgres engine | tiers, modes, static tier |
| operational data | user data, dynamic data (after first use) |
| typed function | endpoint, API route |
| approval, a person approves | confirm, admin review |
| agent | AI, bot, LLM (in prose) |
| Studio | the dashboard, the admin |

Define MCP once per page that needs it: "the Model Context Protocol (MCP),
the open standard that lets agents use tools".

## Links

- Link the first mention of another concept to its page, with the page's
  name or a natural phrase as the text. Never "click here" or "this page".
- Link within the page with the heading's anchor.

## The Markdown twin

Every page is served as Markdown at `/docs/<slug>.md` and in `llms-full.txt`.
Write so that it reads correctly with components stripped: no meaning that
lives only in an icon, a color or a tab label.
