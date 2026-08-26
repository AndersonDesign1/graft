/**
 * The second autosave guard: no PUT unless the draft differs from the file we
 * read. Every `false` here is a file left alone; every missed `true` is an
 * operator's edit silently dropped.
 */
import { describe, expect, it } from "vitest";
import { type DocumentDraft, hasUnsavedChanges, buildSavePayload } from "./draft";

const loaded = {
  data: { title: "Quickstart", order: 2, draft: false },
  body: "# Quickstart\n\nInstall it.\n",
  raw: "---\ntitle: Quickstart\norder: 2\ndraft: false\n---\n\n# Quickstart\n\nInstall it.\n",
};

const draft = (over: Partial<DocumentDraft> = {}): DocumentDraft => ({
  mode: "rich",
  data: { title: "Quickstart", order: 2, draft: false },
  body: loaded.body,
  raw: loaded.raw,
  loaded,
  ...over,
});

describe("hasUnsavedChanges", () => {
  it("is false for a document that was only opened", () => {
    expect(hasUnsavedChanges(draft())).toBe(false);
    expect(hasUnsavedChanges(draft({ mode: "raw" }))).toBe(false);
  });

  it("never reports changes before a document has loaded", () => {
    // The window where an editor is mounted but the fetch has not landed —
    // saving here would overwrite the file with an empty buffer.
    expect(hasUnsavedChanges(draft({ loaded: null, body: "", raw: "", data: {} }))).toBe(false);
  });

  it("catches a body edit", () => {
    expect(hasUnsavedChanges(draft({ body: `${loaded.body}\nOne more line.\n` }))).toBe(true);
  });

  it("catches an edit to each field type", () => {
    const cases: Array<Record<string, string | number | boolean>> = [
      { title: "Quick start" }, // string
      { order: 3 }, // number
      { draft: true }, // boolean
    ];
    for (const change of cases) {
      expect(hasUnsavedChanges(draft({ data: { ...draft().data, ...change } }))).toBe(true);
    }
  });

  it("does not mistake a same-valued field for an edit", () => {
    // Typing a character and deleting it again must not leave a dirty file.
    const data = { ...draft().data, title: String(loaded.data.title) };
    expect(hasUnsavedChanges(draft({ data }))).toBe(false);
  });

  it("catches a cleared optional field, which a per-key comparison could not", () => {
    const { order: _dropped, ...withoutOrder } = draft().data;
    expect(hasUnsavedChanges(draft({ data: withoutOrder }))).toBe(true);
  });

  it("does not call a structurally identical nested value an edit", () => {
    // The asset widget rebuilds `{ key, alt }` on every render; comparing by
    // identity would mark the document dirty just for looking at it.
    const withAsset = { ...loaded, data: { ...loaded.data, image: { key: "a/b.png" } } };
    const same = { ...draft().data, image: { key: "a/b.png" } };
    expect(hasUnsavedChanges(draft({ data: same, loaded: withAsset }))).toBe(false);
  });

  it("compares the whole file in raw mode", () => {
    // Frontmatter is inside `raw`, so body/field state is irrelevant there.
    expect(hasUnsavedChanges(draft({ mode: "raw", body: "totally different" }))).toBe(false);
    expect(hasUnsavedChanges(draft({ mode: "raw", raw: `${loaded.raw}\n` }))).toBe(true);
  });

  it("treats whitespace-only reformatting as a change it must not invent", () => {
    // The editor's mount-time normalisation looks like this. It is a real
    // difference, so this returns true — which is why the write path also
    // needs `watchEditIntent` to never hand us the normalised text unasked.
    expect(hasUnsavedChanges(draft({ body: loaded.body.replace(/\n\n/g, "\n") }))).toBe(true);
  });
});

describe("buildSavePayload", () => {
  const loaded = { data: { title: "A" }, body: "A body", raw: "---\ntitle: A\n---\nA body" };

  it("returns null when nothing changed", () => {
    expect(
      buildSavePayload(
        { collection: "docs", slug: "a" },
        { mode: "rich", data: { title: "A" }, body: "A body", raw: loaded.raw, loaded },
      ),
    ).toBeNull();
  });

  it("writes the edited bytes to the document they were loaded from", () => {
    // The cross-document overwrite: the editor took collection/slug from the
    // current route while taking the bytes from a ref, so a flush during an
    // A -> B navigation wrote A's content to B's path and destroyed it.
    // Identity is now an argument, from the same snapshot as the content.
    const payload = buildSavePayload(
      { collection: "docs", slug: "a" },
      { mode: "rich", data: { title: "A edited" }, body: "A body", raw: loaded.raw, loaded },
      "main",
    );

    expect(payload).toEqual({
      collection: "docs",
      slug: "a",
      branch: "main",
      data: { title: "A edited" },
      body: "A body",
    });
  });

  it("sends raw source in raw mode and nothing else", () => {
    const payload = buildSavePayload(
      { collection: "docs", slug: "a" },
      { mode: "raw", data: { title: "A" }, body: "A body", raw: "changed", loaded },
    );
    expect(payload).toMatchObject({ collection: "docs", slug: "a", raw: "changed" });
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("data");
  });

  it("refuses to write a document that was never loaded", () => {
    expect(
      buildSavePayload(
        { collection: "docs", slug: "a" },
        { mode: "rich", data: { title: "X" }, body: "b", raw: "r", loaded: null },
      ),
    ).toBeNull();
  });
});
