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
 * On MDX: a commonmark editor has no node type for `<Callout>`, but it does
 * have one for raw HTML, and an unbroken JSX block parses as exactly that —
 * so it survives the round trip untouched. Rather than refuse those documents
 * on sight (the old `hasMdxSyntax` regex, which locked out three of twenty
 * real docs that were provably safe), the editor now *proves* fidelity per
 * document: Milkdown re-serialises on mount, and `onFidelity` reports that
 * text so the caller can compare it against the bytes it loaded.
 */
import { Crepe } from "@milkdown/crepe";
// From @milkdown/core, the same entry Crepe resolves internally. Importing the
// re-export at `@milkdown/kit/core` gives a *different* module instance under
// Vite's dep pre-bundling, and a Slice is identified by object identity — so
// the ctx update would look up a slice that Crepe's copy of core never
// injected and throw `contextNotFound`. vite.config.ts dedupes these too.
import { editorViewOptionsCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { useEffect, useRef } from "react";
import { watchEditIntent } from "../lib/edit-intent";
import { mdxNodeViews } from "./mdx-card";

export function RichEditor({
  value,
  onChange,
  onFidelity,
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /**
   * Fired once, with the editor's own re-serialisation of `value`. This is
   * the mount-time `markdownUpdated` that `watchEditIntent` suppresses as an
   * edit — the same event, read for what it actually tells us: exactly what
   * this editor would write to disk if the operator typed one character.
   */
  onFidelity?: (roundTripped: string) => void;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const crepe = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onFidelityRef = useRef(onFidelity);
  onFidelityRef.current = onFidelity;

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let probed = false;

    // Milkdown emits `markdownUpdated` the moment it mounts, from its own
    // re-serialisation rather than anything the operator did. Suppress those.
    const intent = watchEditIntent(host.current);

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

    // Match the serialiser to how these files are actually written. remark
    // defaults to `*` for bullets, which would rewrite every list in the
    // repository the first time someone touched a document — churn with no
    // meaning behind it. The fidelity check forgives marker style, but not
    // creating the diff at all is better than forgiving it.
    // MDX components render as cards rather than as their own source. This is
    // presentation only: the `html` node keeps its exact `value`, so what gets
    // serialised is unchanged and the fidelity probe below still governs.
    instance.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        nodeViews: { ...options.nodeViews, ...mdxNodeViews },
      }));
    });

    instance.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: "-" as const,
        emphasis: "_" as const,
        strong: "*" as const,
        fences: true,
        rule: "-" as const,
      }));
    });

    instance.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (disposed) return;
        // An emission with no interaction behind it is the mount
        // re-serialisation: the fidelity probe, never an edit. Keyed on
        // `intent.touched` rather than "is this the first one" on purpose —
        // if Milkdown ever stops emitting on mount, "first" would swallow the
        // operator's opening keystroke as a probe and drop the edit.
        if (!intent.touched) {
          if (!probed) {
            probed = true;
            onFidelityRef.current?.(markdown);
          }
          return;
        }
        onChangeRef.current(markdown);
      });
    });

    void instance.create().then(() => {
      if (disposed) return;
      instance.setReadonly(readOnly);
      crepe.current = instance;
    });

    return () => {
      disposed = true;
      crepe.current = null;
      intent.dispose();
      void instance.destroy();
    };
    // `value` seeds the document; syncing it here would fight typing. Swapping
    // documents is handled by the key the caller passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  return <div className="rich" ref={host} data-slot="rich-editor" />;
}
