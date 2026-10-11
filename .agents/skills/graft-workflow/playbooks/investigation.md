# Investigation

A read-only question. The deliverable is a cited answer, not a change.

1. Restate the question in one sentence, and what would count as an answer.
2. Map the subsystem. Use `CONTEXT.md` for names, then trace from the entry
   point (CLI command, MCP tool, HTTP route, SDK call) to the code that does
   the work. Send wide searches to an `Explore` subagent.
3. For "why is it this way", read the history: `git log -S '<symbol>'`,
   `git log --follow <file>`, the PR that introduced it, its changeset, and
   `docs/adr/` and `docs/design-notes/`.
4. When reading is not enough, run it (`graft-verify`) and observe.
5. Answer: the direct answer first, then the evidence with `file:line` and
   commit or PR links, then what you could not confirm.

**Reply:** the answer, its evidence, each claim labeled verified, inferred or
guess, and any follow-up worth a task.
