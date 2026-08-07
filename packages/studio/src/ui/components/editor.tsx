/**
 * MDX source editor — CodeMirror 6.
 *
 * A <textarea> can't show structure, and MDX is exactly the case where
 * structure is the point: frontmatter, headings, links, fences and JSX all
 * read the same in plain text. This highlights them.
 *
 * The theme is built from CSS custom properties rather than fixed colours, so
 * it follows the token layers and the light/dark toggle without a second
 * theme definition or a remount.
 */
import { javascript } from "@codemirror/lang-javascript";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/**
 * Syntax colours. `--code-*` are the shiki-matched tokens tokens.css already
 * defines for the docs site, so a fenced block here and the same block on the
 * docs site are coloured identically.
 */
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--code-key)", fontWeight: "600" },
  { tag: tags.heading1, color: "var(--code-key)", fontWeight: "600" },
  { tag: tags.heading2, color: "var(--code-key)", fontWeight: "600" },
  { tag: tags.strong, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.emphasis, color: "var(--ink)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--code-prompt)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--code-prompt)" },
  { tag: tags.monospace, color: "var(--code-string)" },
  { tag: tags.quote, color: "var(--ink-muted)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--code-type)" },
  { tag: tags.comment, color: "var(--code-comment)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--code-keyword)" },
  { tag: tags.string, color: "var(--code-string)" },
  { tag: tags.number, color: "var(--code-constant, var(--code-prompt))" },
  { tag: tags.bool, color: "var(--code-keyword)" },
  { tag: tags.null, color: "var(--code-keyword)" },
  { tag: tags.propertyName, color: "var(--code-key)" },
  { tag: tags.definition(tags.propertyName), color: "var(--code-key)" },
  { tag: tags.typeName, color: "var(--code-type)" },
  { tag: tags.tagName, color: "var(--code-type)" },
  { tag: tags.attributeName, color: "var(--code-key)" },
  { tag: tags.angleBracket, color: "var(--ink-faint)" },
  { tag: tags.processingInstruction, color: "var(--ink-faint)" },
  { tag: tags.contentSeparator, color: "var(--ink-faint)" },
  { tag: tags.meta, color: "var(--ink-faint)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "0.8125rem",
    color: "var(--ink)",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
    // Room for a caret at the last line without it sitting on the border.
    padding: "0.5rem 0 4rem",
  },
  ".cm-content": { caretColor: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--ink-faint)",
    border: "none",
    paddingRight: "0.5rem",
  },
  ".cm-lineNumbers .cm-gutterElement": { fontSize: "0.6875rem" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-muted)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection-bg)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--editor-match)" },
  ".cm-placeholder": { color: "var(--ink-faint)" },
});

export function MdxEditor({
  value,
  onChange,
  readOnly = false,
  showLineNumbers = false,
  placeholder = "",
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  showLineNumbers?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Held in a ref so changing the handler never forces the editor to rebuild
  // (which would drop the cursor and the undo stack mid-edit).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      // MDX is markdown plus JSX; the JS parser handles the embedded blocks
      // and the fenced-code languages.
      markdown({ base: markdownLanguage, codeLanguages: [], extensions: [] }),
      javascript({ jsx: true, typescript: true }),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    if (showLineNumbers) extensions.unshift(lineNumbers());
    if (placeholder) extensions.push(cmPlaceholder(placeholder));

    const instance = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    if (ariaLabel) instance.contentDOM.setAttribute("aria-label", ariaLabel);
    view.current = instance;

    return () => {
      instance.destroy();
      view.current = null;
    };
    // `value` is intentionally excluded — it seeds the document, and syncing
    // it here would fight the user's typing. External replacement is handled
    // by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, showLineNumbers, placeholder, ariaLabel]);

  // Adopt a new document only when it genuinely differs, so switching files
  // or reloading after a save replaces the buffer while typing does not.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="editor" ref={host} data-slot="editor" />;
}
