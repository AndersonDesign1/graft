/**
 * Rich body editor — Milkdown (ProseMirror + remark), styled from our tokens.
 *
 * Markdown source in a textarea shows you syntax, not structure. This renders
 * the document the way GitHub or Notion would: real headings, real lists, real
 * tables, edited in place.
 *
 * Milkdown over the alternatives because it is markdown-*native* — remark
 * parses in and serialises out, so round-tripping is the core of the library
 * rather than a plugin bolted on. That matters here: every save rewrites the
 * author's file.
 *
 * The honest limit: MDX is markdown plus JSX, and a commonmark editor has no
 * node type for `<Callout>`. Rather than silently mangle it, `hasMdxSyntax`
 * detects component syntax and the caller keeps those documents in Raw MDX.
 */
import { Crepe } from "@milkdown/crepe";
import { useEffect, useRef } from "react";

/**
 * Does this body contain MDX-specific syntax a commonmark editor would eat?
 *
 * Looks for JSX elements and ESM import/export, the two things MDX adds. Kept
 * deliberately eager: a false positive costs the operator a richer editor, a
 * false negative costs them their content.
 */
export function hasMdxSyntax(body: string): boolean {
  // Fenced code can legitimately contain angle brackets; ignore those regions.
  const withoutFences = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return (
    /<\/?[A-Z][\w.]*[\s/>]/.test(withoutFences) || // <Callout>, <Foo.Bar />
    /^\s*(import|export)\s/m.test(withoutFences) || // ESM in MDX
    /\{[^}\n]*\}/.test(withoutFences.replace(/\$\{[^}]*\}/g, "")) // {expression}
  );
}

export function RichEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const crepe = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /**
   * Has the operator actually touched this document?
   *
   * Milkdown emits `markdownUpdated` as soon as it mounts, because parsing and
   * re-serialising normalises the source — folding long frontmatter, dropping
   * a blank line, re-wrapping tables. Treated as an edit, that means *opening*
   * a document rewrites it, and with autosave on, browsing the tree quietly
   * reformats every file you look at. So changes are ignored until a real
   * input event proves a human is typing.
   */
  const touched = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;

    const instance = new Crepe({
      root: host.current,
      defaultValue: value,
      features: {
        // Milkdown's own placeholder/latex/table extras are fine; the image
        // uploader is not — assets go through Graft's asset store, not a
        // paste-to-base64 path that would inline binaries into MDX.
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.BlockEdit]: true,
        [Crepe.Feature.Toolbar]: true,
        [Crepe.Feature.CodeMirror]: true,
      },
    });

    instance.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (disposed || !touched.current) return;
        onChangeRef.current(markdown);
      });
    });

    // These are the events that mean "a person is editing", as opposed to the
    // editor settling after mount. `beforeinput` covers typing, paste, drop
    // and IME; the rest cover the toolbar and slash menu, which act on the
    // document without an input event.
    const markTouched = (): void => {
      touched.current = true;
    };
    const node = host.current;
    for (const type of ["beforeinput", "keydown", "paste", "drop", "cut"] as const) {
      node.addEventListener(type, markTouched, true);
    }
    // Toolbar and block-handle actions dispatch pointer events, not input ones.
    node.addEventListener("pointerdown", markTouched, true);

    void instance.create().then(() => {
      if (disposed) return;
      instance.setReadonly(readOnly);
      crepe.current = instance;
    });

    return () => {
      disposed = true;
      crepe.current = null;
      for (const type of ["beforeinput", "keydown", "paste", "drop", "cut"] as const) {
        node.removeEventListener(type, markTouched, true);
      }
      node.removeEventListener("pointerdown", markTouched, true);
      void instance.destroy();
    };
    // `value` seeds the document; syncing it here would fight typing. Swapping
    // documents is handled by the key the caller passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  return <div className="rich" ref={host} data-slot="rich-editor" />;
}
