# [MEDIUM] loadItem joins unvalidated item name onto registry root (filesystem probe primitive)

**File:** [`packages/registry/src/registry.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/src/registry.ts#L40-L77) (lines 40, 58, 77)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `path-traversal`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

const dir = join(root, name) (L40) uses the caller-supplied name verbatim. This is reachable with fully client-controlled input: the MCP tool describe_item passes its raw z.string() argument straight through (packages/mcp/src/server.ts:539 describeItem(loadItem(name, options.registryRoot))), and resolveItems does the same for CLI names and registryDependencies. A name like '../../../../etc' makes existsSync probe <anywhere>/registry.item.json, and the three error branches leak distinguishing information about what exists there: NOT_FOUND (L42-50) vs JSON-parse failure whose message embeds parser output from the probed file (L58: e.g., 'Unexpected token h in JSON at position 0') vs schema-validation failure. That yields a filesystem existence/content-shape oracle plus reflection of the traversal string in error details. Importantly, actual loading of an out-of-root manifest IS blocked: parsed.data.name must satisfy the kebab-case regex and equal the directory argument (L77-84), which traversal strings can never do — so this degrades to information disclosure rather than arbitrary item installation. Impact is bounded further by the MCP server running locally on the developer's machine, but the unauthenticated-MCP threat mode (GRAFT_MCP_REQUIRE_AUTH off) still exposes the oracle to any local client.

## Recommendation

Validate name against the same kebab-case pattern used in the manifest schema (/^[a-z0-9]+(?:-[a-z0-9]+)*$/) at the top of loadItem (and before visit() in resolveItems), throwing REGISTRY_ITEM_INVALID for anything else; additionally assert path.relative(root, dir) does not start with '..' after joining.

## Revalidation

**Verdict:** true-positive

Verified end-to-end: mcp/src/server.ts L539 registers describe_item with inputSchema name: z.string() and passes it raw into loadItem(name, options.registryRoot), where L40 does join(root, name) with zero validation before existsSync(join(dir, 'registry.item.json')). The three observable outcomes are genuinely distinguishable through guarded()/fail(), which serializes the full GraftError message to the MCP client: NOT_FOUND (message reflects the traversal string plus available items), REGISTRY_ITEM_INVALID from JSON.parse whose V8 error message embeds a snippet of the probed file's content, and schema-validation failure — giving a filesystem existence and content-shape oracle for <any-traversable-dir>/registry.item.json using fully client-controlled input. This is concretely reachable by any local MCP client, and unauthenticated MCP is an explicit threat-model case when requireActor is off (the default dev posture). Impact is correctly bounded in the finding: installing an out-of-root item is impossible because parsed.data.name must satisfy the kebab-case regex and equal the directory argument, which traversal strings containing '/' can never do, and the server runs locally — so this degrades to information disclosure/recon rather than write primitive. Real, exploitable as described, with modest impact; the proposed kebab-case validation at the top of loadItem is the right fix.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
