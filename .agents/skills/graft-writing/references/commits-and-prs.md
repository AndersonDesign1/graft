# Commits, changesets and pull requests

These are public and permanent. They describe the change and its reasons,
never the conversation that produced it.

## Commit messages

Conventional Commits, as the history uses them:

```
fix(compiler): refuse dangling symlinks, explain a read-only delete

resolveContained checked symlinks with existsSync, which follows the link,
so a dangling symlink read as absent and a write then created its target
outside the content directory. Use lstat. A delete on a read-only tree now
fails with CONTENT_TREE_READ_ONLY like a write does.
```

- Types: `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`. Scope is
  the package or app: `cli`, `compiler`, `mcp`, `studio`, `docs-site`,
  `sdk-next`.
- The subject is lowercase after the colon, says the outcome, no period,
  under about 72 characters. Several outcomes are joined by commas.
- The body explains what was wrong and why, in the past tense, then what
  changed, in the present. Name the function, file or error code involved,
  where there is one.
- Breaking changes say `!` after the scope and explain who must change what.

## Changesets

Every change to a published package (`@usegraft/*`) has one in
`.changeset/`; private packages and the docs site do not. Name it for the change
(`approval-policy-to-config.md`).

- Start with the change in bold if it is breaking: `**BREAKING:** approval
  policy moves from ... to ...`.
- Then the reason, written for someone upgrading: what was true before, why
  it was wrong, what is true now.
- Include the new config or code the reader needs, in a fenced block.
- Changesets become the public changelog page. Write them to be read there.

## Pull requests

Title: the same shape as a commit subject, describing the whole PR:
"docs: redesigned and rewritten docs, with the product fixes they exposed".

The body follows `.github/PULL_REQUEST_TEMPLATE.md`. Treat it as a briefing
for a reviewer who has the diff open and one minute: short sentences, few
identifiers, no lab notebook.

- **What changed.** One paragraph: what a user or maintainer can now do, or
  what no longer goes wrong. Name a symbol or path only when it carries the
  change.
- **Why.** The problem, the issue link, and what the change deliberately
  leaves out. Mention a rejected alternative only if a reviewer would ask.
- **Breaking?** What breaks and what a user must change, or "No".
- **How you tested it.** Real commands and their real output, verbatim:
  the failing run and the passing run for a fix, the screenshots for UI.
  "Ran the tests" is not a test report.
- **Checklist.** Tick only what you actually ran.

A large PR may add area headings (Docs, Packages, CI) under What changed.
SHAs, long logs and review-bot recitals go in a linked comment, not the body.

Never paste a private prompt, a chat transcript, internal planning notes or
credentials into a commit, changeset or PR. Only the finished result and its
reasons go to GitHub.
