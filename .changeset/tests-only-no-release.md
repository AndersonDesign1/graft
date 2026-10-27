---
---

Tests, lint rules and test tooling only. The one change under a package's
`src` outside a test file is `@usegraft/db`'s scratch-database helper, which
the integration tests import by path and the package does not build or
export. Nothing published changes.
