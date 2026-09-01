---
"@usegraft/cli": minor
"@usegraft/core": patch
"@usegraft/mdx-safety": patch
---

**BREAKING:** approval policy moves from `GRAFT_APPROVAL_POLICY` to
`approvalPolicy` in `graft.config.ts`. The env var is ignored, and `graft serve`
warns once at boot if it is still set.

`createFunctionsHandler` has documented this setting as config-owned all along:
"deliberately a value the operator writes in config rather than an env var,
because turning off the gate on irreversible work should appear in a diff and a
review." The CLI was the piece still reading an env var, so the rationale was
written down and not enforced. This is the setting that lets `deleteRecord`
hard-delete rows with no human in the loop, and a hosting dashboard is where
that decision goes unreviewed. It is parsed like `mdxTrust`: an unknown value is
refused rather than defaulted, so a typo cannot silently pick a weaker policy.

```ts
// graft.config.ts
export const approvalPolicy = "unattended";
```

**An approval presented to an ungated call is now spent.** Under `"unattended"`
the gate is skipped, and the whole block went with it, including
`approvals.consume`. A granted row stayed `approved` and replayable: tighten the
policy later and that row still authorized a destructive call nobody
re-reviewed. One-shot has to survive a policy change, which is exactly when the
stale row is dangerous. Consuming is best-effort here, because an ungated call
must not fail on the approval store.

**`run_function` over MCP gets the same rate-limit backstop as `POST /api/fn`.**
`graft serve` passed `{ limit: 60, windowSeconds: 60 }` to the functions handler
and nothing to the MCP handler, so a function with no per-function `rateLimit`
was capped on one transport and uncapped on the other. `tools/functions.ts`
claims both surfaces apply rate limits identically; now they do.

**`assertSafeMdx` reports unparseable MDX as `INPUT_VALIDATION_FAILED`.**
`UncheckableMdxError` escaped it raw, so `write_content` and a Studio save
returned a bare `Error` where every other rejection on that path is a structured
`GraftError` — a client could not tell malformed input from a transport fault.
`graft compile` catches the raw error itself and is unaffected.

All four found by cubic on the pull request.
