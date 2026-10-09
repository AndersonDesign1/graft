/**
 * Studio tells the app when a save or compile changed the index.
 *
 * The compile itself needs Postgres, so only `compile` is replaced. The file
 * write and the notifier are the real ones.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChangeSet } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const compiled: { changes: ChangeSet } = {
  changes: { added: [], changed: [], removed: [], unchanged: 0 },
};

vi.mock("@usegraft/compiler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/compiler")>();
  return {
    ...actual,
    compile: vi.fn(async () => ({
      count: 1,
      docs: [],
      changes: compiled.changes,
      gitSha: "abc123",
    })),
  };
});

const { createStudioApiHandler } = await import("./api");

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

let contentDir: string;

beforeEach(() => {
  contentDir = mkdtempSync(join(tmpdir(), "graft-studio-change-"));
});

afterEach(() => {
  rmSync(contentDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function handlerWith(onContentChange?: (event: unknown) => void | Promise<void>) {
  return createStudioApiHandler({
    db: {} as never,
    collections,
    contentDir,
    defaultBranch: "main",
    onContentChange,
  });
}

function mutate(method: "PUT" | "POST", path: string, body: unknown): Request {
  return new Request(`http://localhost/api/studio/v1/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const save = mutate.bind(null, "PUT", "document", {
  collection: "pages",
  slug: "about",
  raw: "---\ntitle: About\n---\n\nHello.\n",
});

describe("Studio onContentChange", () => {
  it("tells the app after a save that changed the index", async () => {
    compiled.changes = { added: ["pages/about"], changed: [], removed: [], unchanged: 0 };
    const listener = vi.fn();
    const res = await handlerWith(listener)(save());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ written: "pages/about.mdx", refresh: { ok: true } });
    expect(listener).toHaveBeenCalledWith({
      branch: "main",
      gitSha: "abc123",
      changes: compiled.changes,
    });
  });

  it("tells the app after an operator compile", async () => {
    compiled.changes = { added: [], changed: ["pages/home"], removed: [], unchanged: 2 };
    const listener = vi.fn();
    const res = await handlerWith(listener)(mutate("POST", "compile", { branch: "preview" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      branch: "preview",
      changed: 1,
      refresh: { ok: true },
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ branch: "preview" }));
  });

  it("stays quiet when nothing changed", async () => {
    compiled.changes = { added: [], changed: [], removed: [], unchanged: 3 };
    const listener = vi.fn();
    const res = await handlerWith(listener)(save());

    expect(await res.json()).not.toHaveProperty("refresh");
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the save when the app could not be told, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    compiled.changes = { added: ["pages/about"], changed: [], removed: [], unchanged: 0 };
    const res = await handlerWith(() => {
      throw new Error("route down");
    })(save());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      written: "pages/about.mdx",
      refresh: { ok: false, error: "REVALIDATE_FAILED" },
    });
  });
});
