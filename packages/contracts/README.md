# @usegraft/contracts

> Shared error codes and introspection schemas. The vocabulary every other Graft package speaks.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/contracts
```

You rarely install this directly. It arrives as a dependency of the packages that throw.

## Errors an agent can act on

```ts
import { GraftError, ErrorCodes } from "@usegraft/contracts";

throw new GraftError({
  code: "INPUT_VALIDATION_FAILED",
  message: 'Slug "My Page" is not URL-safe.',
  fix: 'Slugs are kebab-case: lowercase letters, digits and single hyphens, e.g. "my-page".',
  details: { slug: "My Page" },
});
```

`fix` is not decoration. Every error carries the next action, because the primary reader is an agent deciding what to do rather than a human reading a stack trace. That is why `message` says what happened and `fix` says what to do about it.

## Introspection

`CollectionDescriptor`, `FieldDescriptor`, `FunctionDescriptor` and the registry descriptors are the shapes `describe_schema` and friends return over MCP. They are declared here so the CLI, the MCP server and the Studio cannot drift on what a collection looks like.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/contracts/CHANGELOG.md)
