---
"@usegraft/mcp": patch
---

Declare `outputSchema` on the 16 tools whose answer has a fixed shape, so
`structuredContent` is a validated contract rather than a convenience.

The SDK checks every result against the schema before it leaves the server, so
a tool that quietly changes shape now fails at its own boundary instead of in
whatever the agent tried to do with the answer. Where a contract already existed
in `@usegraft/contracts` it is reused rather than restated: `describe_schema`,
`describe_function` and `describe_item` were already published shapes with a
drift test, and this attaches them to the wire.

`run_function` and `delete_content` deliberately keep no schema. Both return
whatever the project's own function returns, so a declared shape would promise
nothing and cost a validation pass. They are an explicit exemption in the test
rather than an omission that looks like an oversight.
