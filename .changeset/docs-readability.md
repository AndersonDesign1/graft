---
"@usegraft/mcp": patch
"@usegraft/tokens": patch
---

Clearer wording for two error explanations. `NEEDS_DATABASE` now says the project runs on the static storage engine and the feature needs the Postgres engine, instead of "static index mode" and "Postgres-tier". The registry entry now says "core registry" instead of "Tier-1 registry". `@usegraft/tokens` adds a `--measure` token for the reading width of prose. It also defines `--space-5`, which eight declarations already used while it was undefined, so callouts and other spaced elements lost their padding. Callouts get their own note and warning hues instead of reusing the accent, and `--n-10` names pure white for text on the primary color in dark mode.
