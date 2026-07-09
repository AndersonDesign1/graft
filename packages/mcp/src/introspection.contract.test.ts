/**
 * Introspection contract tests (P6.3) — lock the agent-facing surface.
 *
 * Every introspection tool's output must validate against the published
 * @graft/contracts Zod schema. A change to a describe() shape that would
 * silently break cold agents fails here instead. Covers the full descriptor
 * surface: collections (incl. recursive object/array fields), functions (all
 * flags), and the registry browse tools over the real bundled registry.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FunctionDescriptor,
  RegistryItemDescriptor,
  SchemaDescription,
} from "@graft/contracts";
import { defineCollection, defineFunction, field } from "@graft/core";
import type { Database } from "@graft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createGraftMcp } from "./server";

const collections = {
  // Nested object + array-of-object → exercises the recursive FieldDescriptor path.
  pages: defineCollection({
    name: "pages",
    description: "Pages with nested fields",
    fields: {
      title: field.string({ description: "Headline" }),
      faqs: field.array({
        optional: true,
        description: "FAQ entries",
        of: field.object({
          fields: {
            question: field.string({ description: "The question." }),
            answer: field.string({ description: "The answer." }),
          },
        }),
      }),
    },
  }),
  orders: defineCollection({
    name: "orders",
    authority: "db-authoritative",
    fields: { email: field.string() },
  }),
};

const functions = {
  stats: defineFunction({
    name: "stats",
    kind: "query",
    returns: "{ count: number }",
    input: {},
    handler: () => ({ count: 0 }),
  }),
  place: defineFunction({
    name: "place",
    kind: "mutation",
    public: true,
    input: { email: field.string() },
    handler: () => ({ ok: true }),
  }),
  wipe: defineFunction({
    name: "wipe",
    kind: "mutation",
    destructive: true,
    input: { id: field.string() },
    handler: () => ({ ok: true }),
  }),
};

/** Introspection never touches the database — this proxy fails the test if it does. */
const untouchableDb = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`introspection touched the database (accessed ${String(prop)})`);
    },
  },
) as Database;

let client: Client;
let dir: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return { isError: result.isError === true, payload: JSON.parse(result.content[0]?.text ?? "null") };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-contract-"));
  const server = createGraftMcp({ contentDir: dir, collections, functions, db: untouchableDb });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "contract-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("introspection contract", () => {
  it("describe_schema conforms to SchemaDescription", async () => {
    const { payload } = await call("describe_schema");
    expect(() => SchemaDescription.parse(payload)).not.toThrow();
  });

  it("nested object/array fields survive introspection recursively", async () => {
    const parsed = SchemaDescription.parse((await call("describe_schema")).payload);
    const pages = parsed.collections.find((collection) => collection.name === "pages");
    const faqs = pages?.fields.find((f) => f.name === "faqs");
    expect(faqs?.type).toBe("array");
    expect(faqs?.items?.type).toBe("object");
    expect(faqs?.items?.fields?.map((f) => f.name)).toEqual(["question", "answer"]);
  });

  it("describe_function conforms to FunctionDescriptor for every function", async () => {
    const { payload: list } = await call("list_functions");
    for (const fn of list.functions as { name: string }[]) {
      const { payload } = await call("describe_function", { name: fn.name });
      expect(() => FunctionDescriptor.parse(payload)).not.toThrow();
    }
  });

  it("reports function flags (public / destructive)", async () => {
    const parsed = SchemaDescription.parse((await call("describe_schema")).payload);
    const byName = Object.fromEntries(parsed.functions.map((fn) => [fn.name, fn]));
    expect(byName.place?.public).toBe(true);
    expect(byName.wipe?.destructive).toBe(true);
  });

  it("describe_item conforms to RegistryItemDescriptor; list_registry to its summary", async () => {
    const { payload: list } = await call("list_registry");
    const summary = z.object({
      items: z.array(
        z.object({
          name: z.string(),
          type: RegistryItemDescriptor.shape.type,
          description: z.string(),
          registryDependencies: z.array(z.string()),
        }),
      ),
    });
    expect(() => summary.parse(list)).not.toThrow();
    expect(list.items.length).toBeGreaterThan(0);
    for (const item of list.items as { name: string }[]) {
      const { payload } = await call("describe_item", { name: item.name });
      expect(() => RegistryItemDescriptor.parse(payload)).not.toThrow();
    }
  });
});
