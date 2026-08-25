# DeepSec findings — Graft

Security review of this repository, generated 2026-08-25.

## Scan

| Field | Value |
|-------|-------|
| Project | `graft` |
| Files scanned / analyzed | 127 / 127 |
| Pattern-scan candidates | 231 |
| Agent | Pi |
| Model | `openrouter/stealth/ox-alpha` via OpenRouter (custom Pi route) |
| Thinking level | `xhigh` |
| Sandboxes | none (local process; no Vercel login) |

`process` and `revalidate` both completed. Revalidation: **55 true-positive**, **4 false-positive**, **2 uncertain**. Export hides false-positives and other resolved verdicts.

## Counts (exported)

| Severity | Files |
|----------|-------|
| HIGH | 10 |
| MEDIUM | 33 |
| HIGH_BUG | 1 |
| BUG | 13 |
| **Total** | **57** |

Severity totals in `REPORT.md` (60) include false-positives that this directory does not export. One additional candidate in `examples/docs-site/src/lib/actor.ts` was dropped as malformed (`revalidation.reasoning` missing) and is not listed.

## How to read this directory

- `REPORT.md` — full narrative summary with recommendations.
- `HIGH/`, `MEDIUM/`, `HIGH_BUG/`, `BUG/` — one markdown file per exported finding.
- Each finding file has file path, lines, slug, confidence, revalidation verdict, and a recommended fix.

Highest-impact themes:

1. MCP HTTP mounts fail open (`GRAFT_MCP_REQUIRE_AUTH` unset → anonymous tools).
2. `decide_approval` trusts a caller-supplied identity, enabling self-approval of destructive ops.
3. Studio operator endpoints treat any non-anonymous actor as authorized.
4. `put_asset` path traversal / arbitrary file read; unvalidated Studio document slugs.
5. `MdxBody` executing stored MDX as JavaScript in-process (stored RCE if an attacker can write content).

## Reproduction

Workspace state lives in `.deepsec/` (not committed). To re-run later, scaffold DeepSec, point Pi at OpenRouter `stealth/ox-alpha`, then `scan` → `process` → `revalidate` → `export --format md-dir`.
