---
name: graft-writing
description: Write or edit any words in Graft, including docs pages, the landing page, UI labels, error messages and their fix lines, README files, changesets, commit messages and pull request descriptions. Use when drafting, rewriting, reviewing or tightening copy, adding a docs page, writing a changelog entry, or naming a button. Triggers on "write", "reword", "copy", "docs page", "changeset", "commit message", "PR description", "error message", "make this clearer".
---

# Writing for Graft

Graft's docs were rewritten in October 2026 (PR #48) to one standard: a
reader who has never heard of Graft can follow any page, and an agent reading
the Markdown twin gets the same facts. This skill is that standard. Use it
for every word a person or agent reads.

## Load what you need

| Writing | Read |
| --- | --- |
| A docs page, or editing one | [references/docs-pages.md](references/docs-pages.md) |
| Landing copy, UI labels, buttons, errors and `fix` lines | [references/product-copy.md](references/product-copy.md) |
| A commit, changeset or pull request | [references/commits-and-prs.md](references/commits-and-prs.md) |
| Any draft, before you hand it over | [references/ai-tells.md](references/ai-tells.md) |

## The voice in one paragraph

Plain, exact and calm. Write the way a senior engineer explains something to
a capable colleague who is new to the codebase: short sentences, everyday
words, the real names of things, and the reason when the reason helps. Say
what happens, not how impressive it is. Never sell.

## Rules that apply everywhere

1. **Lead with the reader's job.** The first sentence says what this is for or
   what they will have at the end.
2. **One idea per sentence.** Most sentences are under 25 words. Split
   anything with two "and"s and a comma.
3. **Second person, present tense, active voice.** "You compile the
   content", "Graft stops the compile", not "the content is compiled".
4. **Define a term once, at first use, then use it the same way every time.**
   "An **index**: a copy of your content organized for fast queries." The
   names come from `CONTEXT.md`. One name per thing.
5. **Be concrete.** Real commands, real file paths, real error codes, real
   numbers ("Node.js 22.16 or newer", "about 10 minutes"). Never a placeholder
   that looks real.
6. **Say what to do when it goes wrong.** Every error mention pairs the code
   with what it means and the fix.
7. **No em dashes.** Use a period, a comma, a colon or parentheses.
8. **No hype words:** truly, seamless, powerful, blazing, effortless, magic,
   simply, just, robust, cutting-edge, leverage, unlock, supercharge.
9. **No filler devices:** "not X, but Y" reveals, rhetorical questions as
   headings, "worth noting", "it's important to", "in order to".
10. **Sentence case** for every heading, button, label and title.
11. **Name things the way users see them.** "Form submissions", not
    "`data_records` rows", unless the page is about the table.
12. **Be honest about limits.** If something needs Postgres, is beta, or
    cannot be undone, say so where the reader will act on it.

## Before you finish

Read your text once as a first-time reader, then check:

- Does the first sentence say what the reader gets?
- Is every term defined, and named the same way throughout?
- Could each heading be read alone in a table of contents and still make
  sense?
- Search for `—`, "simply", "just", "truly", "seamless". Remove them.
- Scan against [references/ai-tells.md](references/ai-tells.md).
- Is every command, path, version and error code copied from the source?
- Docs only: does the Markdown twin read correctly with no components
  rendered?
