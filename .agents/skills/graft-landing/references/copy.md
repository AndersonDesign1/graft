# Marketing copy

`graft-writing` applies in full. This adds what changes when the reader may
not be a developer.

## Who is reading

Someone who already runs a CMS and is deciding whether to switch: a
developer, an editor or marketer, or the person who pays for it. They know
what a content model, an editor, a draft, a preview and a publish button are.
They do not know what "compile", "index" or "MCP" mean to Graft. Copy that
only the author of Graft understands has failed.

Before writing, read how the CMS they use now talks to them. Payload and
Sanity are the nearest:

```sh
node .agents/skills/graft-landing/scripts/page-copy.cjs https://payloadcms.com/ https://www.sanity.io/
```

What both do, and Graft should too:

- The h1 is the category in a few words. The line under it says who it is
  for and what they get.
- They name the readers by role: developers, editors, marketers, content
  teams. "Code-first for builders. Content-first for marketers."
- A section heading is an outcome for one of those roles.
- They use the buyer's words for the buyer's things.

| Graft's word | What a CMS reader calls it |
| --- | --- |
| Schema, `defineCollection` | Content model |
| Compile | Validate, check, build |
| The index | Your content, ready to query |
| Studio | The editor, the admin |
| Approval, human gate | Approval, sign-off |
| Overlay branch | A preview branch |
| Owned primitives | Features you add: comments, commerce, SEO |
| `data_records` | Form submissions, orders, comments |

Use Graft's word once where the section is about that thing, next to the
reader's word.

## The test

Read the line to someone who builds websites with an agent and has never
opened a terminal. If they would ask what a word means, change the word.

## Rules

- **Say what the reader gets, then how.** "Nothing gets deleted without a
  person saying yes" before "destructive calls are human-gated".
- **Short sentences, one idea each.** Three short sentences beat one with
  two commas.
- **Everyday words.** Repo, file, page, editor, agent, error, delete.
  Introduce a product word (schema, MCP, compile) only where the section is
  about it, and say what it does in the same sentence.
- **Address the reader as "you".** Their agent is "your agent". Their
  colleagues are "your team".
- **A heading is a claim the section proves.** "A delete waits for a
  person." Keep the old page's strong lines where they still hold.
- **Lists are things the reader can now do**, three at most, each starting
  the same way.
- **Buttons are a verb and an object.** The command button is the command.
- **No selling.** No "powerful", "seamless", "truly", "supercharge", no
  exclamation marks, no em dashes.
- **Nothing invented.** No customer names, counts, stars or quotes unless
  the user gives them. Ask for proof; do not manufacture it.

## Before and after

| Before | After |
| --- | --- |
| A screen built for a mouse is a dead end for an agent. | An agent cannot click around an admin screen. |
| It reads your real content model, so it never guesses a field. | It reads how your content is set up before it writes anything. |
| Destructive calls never run the first time. Graft files an approval and holds the call. | An agent can ask to delete a page. It cannot do it alone. |
| A content site compiles to one SQLite file and deploys with your app. | A content site needs no database. Graft builds one small file and your site reads it. |

## Where exact text is required

Inside a product window, text is the product's own: the real command, the
real output, the real error code and `fix` line, copied from a run through
`graft-verify`. Do not tidy it.
