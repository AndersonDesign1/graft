---
name: graft-testing
description: Write, review, trim or audit Graft's tests so each one would fail if the behavior it names broke. Covers what to test and what not to, how to prove a bug fix, timing and skips, coverage floors, and measuring a test's worth with mutation testing before deleting it. Use when adding or changing tests, reviewing a test diff, deciding whether a test earns its place, or asked "are our tests any good?".
---

# Testing Graft

A test earns its place when it fails because the behavior it names broke,
and for no other reason. Coverage says a line ran; it does not say anything
checked the result. Graft's `mdx-safety` had 94% line coverage while dropping
`embed` from the elements it refuses failed nothing.

## What a test is for

Keep, and write first, tests for:

- **Security boundaries:** what the MDX checker refuses, token verification
  and every way it fails closed, scopes, the approval gate, path containment.
- **Data that can be lost:** revert, publish, merge, migrations, the dirty
  check before anything overwrites a file.
- **Contracts an agent reads:** error codes, `fix` lines, MCP tool output, the
  CLI's JSON and exit codes.
- **Parsing outside formats:** frontmatter, MDX, porcelain, JWTs.
- **Every entry of a list that decides something.** A deny list tested by
  three of its seven entries protects three.
- **The type contract,** with `expectTypeOf`, where inference is the product
  (collections, functions, the SDKs).

Do not write tests that:

- **Restate the types** (`typeof x === "string"` on a typed value).
- **Mirror the implementation:** asserting a mock was called with the
  arguments the code passes, or recomputing the expected value the way the
  code does. Assert a literal result instead.
- **Only check that something exists:** `toBeDefined()`, `toBeTruthy()` or
  `not.toThrow()` with nothing after it.
- **Test the framework:** that Zod parses, that React renders a prop.
- **Repeat a case** the table above them already covers.

## Proof for a fix

- A logic, data or protocol bug gets the fewest tests that fail on `main` for
  that reason, in the module's existing test file, before the fix.
- A purely visual bug gets before and after captures (`graft-design`), not a
  test.
- To show a new test guards something, break the code it covers the way a
  regression would and watch it fail. Say so in the PR.

## Time, skips and the environment

- **No sleeps.** `new Promise((r) => setTimeout(r, ms))` is a guess that
  passes on a quiet machine and fails on a loaded runner. Await the event:
  a deferred the code resolves, the promise it returns, or `setImmediate`
  for one loop turn. When real time is the subject (a database timeout),
  let the system that owns the clock wait (`select pg_sleep(1)`).
  `anti-slop/no-sleep-in-tests` enforces this.
- **Order, not timing, for races.** Have the first party signal once it holds
  the lock and wait to be released; then start the second.
- **Wall-clock bounds only with a wide margin**, and only to catch a change
  in complexity (linear to quadratic), never to measure speed.
- **No silent skips.** `it.skip` and `describe.skip` need a comment above
  saying why and what brings the test back
  (`anti-slop/no-unreasoned-test-skip`). Conditional skips (`skipIf`) say why
  in their condition. A test that skips itself when a resource is missing
  throws instead under `CI`.
- **Integration tests** are `*.integration.test.ts`, gated on
  `RUN_INTEGRATION=1` and a `DATABASE_URL`. Run them through
  `.agents/skills/graft-verify/scripts/offline.sh --db <url>` with a database
  from `pg.sh`, never the session's own.

## Measuring a test's worth

```bash
pnpm mutation <package> [file-glob]          # e.g. pnpm mutation mdx-safety src/index.ts
pnpm mutation mcp --ignore-static            # large packages
```

It changes the code in small ways and reports each change no test noticed.
Read the survivors: a survivor in a deny list, a guard or a fail-closed branch
is a missing test; a survivor in an error message's wording usually is not.

`pnpm coverage` holds every package with a floor in
`scripts/coverage-floors.json` at or above it. Raise a floor when you earn it
(`node scripts/coverage.mjs --update`); never lower one to get green.

## Deleting a test

Default to keep. Delete only when all of these hold:

1. It falls in a "do not write" class above, or exactly duplicates another
   test.
2. It is not on a security boundary or a data-loss path. Those are reviewed
   by a person, however weak they look.
3. Removing it does not lower the package's mutation score
   (`pnpm mutation`). "Killed no mutants" alone is not enough: Stryker credits
   only the first test that catches each one.
4. It is not flaky. Fix a flaky test; do not delete it.

Delete in one commit per package, and give the before and after test count
and mutation score in the PR.
