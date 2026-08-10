/**
 * The project's owned component declarations.
 *
 * The contract that matters here is *where they come from*: the project, not
 * the registry. `graft add` copies a declaration in beside the component, and
 * from that moment the operator's copy is the only one that counts — which is
 * what makes it owned code rather than a plugin's opinion.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorComponentSpec } from "@usegraft/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioHandler } from "./handler";

const roots: string[] = [];

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "graft-editor-"));
  roots.push(root);
  mkdirSync(join(root, "content"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function handlerFor(root: string) {
  return createStudioHandler({
    // The endpoint touches neither, and constructing a real Database would make
    // this an integration test for no added coverage.
    db: {} as never,
    collections: {},
    contentDir: join(root, "content"),
    projectRoot: root,
  });
}

const get = async (root: string): Promise<{ components: unknown[] }> => {
  const res = await handlerFor(root)(
    new Request("http://localhost/api/studio/v1/editor-components"),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { components: unknown[] };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("GET /editor-components", () => {
  it("reads the project's declarations", async () => {
    const root = project({
      "graft/editor/Callout.json": JSON.stringify({
        component: "Callout",
        label: "Callout",
        titleProp: "label",
      }),
    });
    const body = await get(root);
    expect(body.components).toHaveLength(1);
    expect(body.components[0]).toMatchObject({ component: "Callout", titleProp: "label" });
  });

  it("is empty, not an error, for a project that has never run graft add", async () => {
    expect((await get(project({}))).components).toEqual([]);
  });

  it("skips a malformed declaration instead of failing the editor", async () => {
    // One bad file should cost one styled card, not every card.
    const root = project({
      "graft/editor/Good.json": JSON.stringify({ component: "Good" }),
      "graft/editor/Bad.json": "{ not json",
      "graft/editor/Wrong.json": JSON.stringify({ label: "no component field" }),
    });
    const body = await get(root);
    expect(body.components).toHaveLength(1);
    expect(body.components[0]).toMatchObject({ component: "Good" });
  });

  it("ignores non-JSON files in the directory", async () => {
    const root = project({
      "graft/editor/Callout.json": JSON.stringify({ component: "Callout" }),
      "graft/editor/README.md": "# notes",
    });
    expect((await get(root)).components).toHaveLength(1);
  });

  it("refuses a tone the theme does not define", async () => {
    // The closed tone set is the reason a third-party declaration cannot
    // introduce a colour; if this ever parses, that guarantee is gone.
    const parsed = EditorComponentSpec.safeParse({
      component: "X",
      tone: { prop: "type", map: { danger: "hotpink" } },
    });
    expect(parsed.success).toBe(false);
  });
});
