/**
 * The second autosave guard: no PUT unless the draft differs from the file we
 * read. Every `false` here is a file left alone; every missed `true` is an
 * operator's edit silently dropped.
 */
import { describe, expect, it } from "vitest";
import { type DocumentDraft, hasUnsavedChanges } from "./draft";

const loaded = {
  data: { title: "Quickstart", order: 2, draft: false },
  body: "# Quickstart\n\nInstall it.\n",
  raw: "---\ntitle: Quickstart\norder: 2\ndraft: false\n---\n\n# Quickstart\n\nInstall it.\n",
};

const draft = (over: Partial<DocumentDraft> = {}): DocumentDraft => ({
  mode: "rich",
  fields: { title: "Quickstart", order: 2, draft: false },
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
    expect(hasUnsavedChanges(draft({ loaded: null, body: "", raw: "", fields: {} }))).toBe(false);
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
      expect(hasUnsavedChanges(draft({ fields: { ...draft().fields, ...change } }))).toBe(true);
    }
  });

  it("does not mistake a same-valued field for an edit", () => {
    // Typing a character and deleting it again must not leave a dirty file.
    const fields = { ...draft().fields, title: String(loaded.data.title) };
    expect(hasUnsavedChanges(draft({ fields }))).toBe(false);
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
