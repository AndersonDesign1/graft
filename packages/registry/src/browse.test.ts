/**
 * Registry browse surface (describeItem / listItems) + the vocabulary drift
 * guard. @usegraft/registry's authoring enums (ITEM_TYPES / FILE_ROLES) must stay
 * identical to @usegraft/contracts' introspection enums, so the descriptor is the
 * single source of truth without contracts depending on registry.
 */
import { RegistryFileRole, RegistryItemDescriptor, RegistryItemType } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { FILE_ROLES, ITEM_TYPES } from "./manifest";
import { describeItem, listItems, loadItem } from "./registry";

describe("registry browse", () => {
  it("lists every bundled item as a valid descriptor, sorted by name", () => {
    const items = listItems();
    const names = items.map((item) => item.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("comments");
    expect(names).toContain("scoped-access");
    for (const item of items) {
      expect(() => RegistryItemDescriptor.parse(item)).not.toThrow();
    }
  });

  it("describes one item without leaking the absolute dir", () => {
    const descriptor = describeItem(loadItem("comments"));
    expect(descriptor).toEqual({
      name: "comments",
      type: "bundle",
      description: expect.stringContaining("Moderated comments"),
      graftVersion: "*",
      dependencies: {},
      registryDependencies: ["scoped-access"],
      files: [{ target: "graft/comments.ts", role: "module" }],
      llms: true,
    });
    expect(descriptor).not.toHaveProperty("dir");
  });

  it("carries npm dependencies through (scoped-access → @usegraft/auth)", () => {
    const descriptor = describeItem(loadItem("scoped-access"));
    expect(descriptor.type).toBe("access");
    expect(descriptor.dependencies).toEqual({ "@usegraft/auth": "workspace:*" });
    expect(descriptor.registryDependencies).toEqual([]);
  });
});

describe("vocabulary stays in lockstep with @usegraft/contracts", () => {
  it("ITEM_TYPES matches RegistryItemType", () => {
    expect([...ITEM_TYPES].sort()).toEqual([...RegistryItemType.options].sort());
  });

  it("FILE_ROLES matches RegistryFileRole", () => {
    expect([...FILE_ROLES].sort()).toEqual([...RegistryFileRole.options].sort());
  });
});
