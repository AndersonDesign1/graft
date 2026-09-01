# @usegraft/registry

> The shadcn-style registry behind `graft add`. Primitives are copied into your repository, not imported from ours.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## The model

`graft add faq` writes real files into `graft/` in your project and regenerates the barrel. You own them from that moment: edit them, delete them, or diverge entirely. There is no version of ours you are pinned to and no upgrade that overwrites your changes.

That is the whole extensibility story. A plugin you cannot read is a plugin an agent cannot edit.

## Install

```bash
npm i @usegraft/registry@beta
```

Most people use `graft add` rather than this package directly.

## Browse

```ts
import { listItems, describeItem, loadItem } from "@usegraft/registry";

const items = listItems();
const detail = describeItem("faq");
```

Agents reach the same surface over MCP as `list_registry` and `describe_item`.

## Apply

```ts
import { loadItem, applyPlan } from "@usegraft/registry";

const item = loadItem("faq");
await applyPlan(plan);
```

`applyPlan` resolves transitive dependencies, writes the files, and regenerates the `graft/` barrel and the MDX component map.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/registry/CHANGELOG.md)
