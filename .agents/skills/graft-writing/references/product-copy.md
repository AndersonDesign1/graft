# Product copy

Landing pages, UI in Studio and the docs chrome, error messages, and `fix`
lines.

## Landing and marketing

The landing page predates these rules and gets rebuilt against them, so do
not copy its current wording.

- The h1 names what Graft is in the fewest words: "The agent-native CMS."
- The lede under it states three facts, each one checkable:
  "Content stays as MDX in your repository. One Zod schema checks every file.
  Agents edit it over MCP, and anything destructive waits for a person."
- Section headings are claims a developer can verify by reading the section:
  "Your content never leaves your repository", "Agents get the tools you use,
  with limits you set".
- Proof beats adjectives. Show a real transcript, a real table, a real
  command, then say one sentence about it.
- No eyebrows, no "Introducing", no "Meet", no exclamation marks.
- Captions say what to notice: "Every error carries a fix, so an agent
  corrects its own write instead of guessing."

## Buttons and labels

- A button is a verb, or a verb and a noun: "Copy page", "Connect an agent",
  "Delete document". A destructive button names the thing it destroys.
- Never "OK", "Confirm", "Submit", "Click here", "Learn more".
- The primary button on a marketing page is "Get started". In docs there is
  no primary button in the header.
- State changes are confirmed in the past tense: "Copied", "Saved",
  "Written and compiled".
- Labels are nouns in sentence case: "On this page", "Last updated",
  "Search the docs".

## Errors and fix lines

Every `GraftError` carries a `code`, a `message` and a `fix`. They are read by
people and agents, so write them as instructions an agent can follow without
guessing.

- **Code:** `SCREAMING_SNAKE_CASE`, names the condition, not the component:
  `SCHEMA_VALIDATION_FAILED`, `NEEDS_DATABASE`, `APPROVAL_SELF_DECISION`.
- **Message:** what is wrong, with the specific file, field or value.
  "tagline: expected string, received number".
- **Fix:** one imperative sentence with the exact next action, and the
  command if there is one. "Run `npx graft compile`, then start your app."
- Never apologize, never blame the reader, never say "something went wrong".
- No em dash inside a `fix`. Today the schema error joins its parts with one
  (`satisfy the "pages" schema — tagline: ...`); new and edited messages use
  a period or a colon before the field list.
- If a fix might not have happened (a network error after a write), say
  what is known: "The save may have reached GitHub. Reload the draft and
  check the production branch before saving again."

## Empty states and confirmation

- An empty state says what will appear and how to add the first one:
  "No approvals are waiting. Destructive calls from agents appear here."
- A confirmation dialog states the consequence and names the object:
  "Delete pages/pricing? This removes the file from Git on the next commit."
