/**
 * Render an MDX component block as a card instead of as its source.
 *
 * Milkdown keeps an unbroken JSX block in an inline `html` atom whose `value`
 * attribute holds the raw bytes. That is a gift: a node view can change what the
 * block *looks* like without touching what it *is*, so the serialiser still
 * writes the author's exact source and the round trip stays byte-identical by
 * construction. Nothing here can corrupt a file — the only path that writes is
 * the explicit source edit below, and it writes precisely what the operator typed.
 *
 * A block that the parser cannot fully understand keeps its old raw rendering.
 * Falling back is always safe; a card that quietly hid part of a document is not.
 */
// Types only. rich-editor.tsx warns that importing *values* from @milkdown/kit
// and @milkdown/core mixes two module instances and breaks Slice identity; type
// imports are erased at build time, so the kit path is safe here — and it is
// the one @milkdown/prose subpath this package can resolve.
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import {
  elementSummary,
  parseInline,
  parseMdxElement,
  type MdxElement,
  type MdxNode,
} from "../lib/mdx-element";

/** Attributes that read as the element's label rather than as configuration. */
const TITLE_ATTRS = ["title", "label", "name", "heading"];
/** Attributes worth showing as a destination chip. */
const LINK_ATTRS = ["href", "to", "url"];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const INLINE_TAG = { strong: "strong", code: "code" } as const;

/** A paragraph whose inline markdown is rendered rather than shown as syntax. */
function textBlock(className: string, value: string): HTMLElement {
  const node = el("p", className);
  for (const token of parseInline(value)) {
    if (token.kind === "text") node.append(token.value);
    else node.append(el(INLINE_TAG[token.kind], undefined, token.value));
  }
  return node;
}

function pick(element: MdxElement, names: string[]): string | undefined {
  return element.attributes.find((a) => names.includes(a.name) && !a.expression)?.value;
}

/** Attributes that are not already shown as the title or the link. */
function restAttributes(element: MdxElement): MdxElement["attributes"] {
  const shown = new Set<string>();
  const title = element.attributes.find((a) => TITLE_ATTRS.includes(a.name) && !a.expression);
  const link = element.attributes.find((a) => LINK_ATTRS.includes(a.name) && !a.expression);
  if (title) shown.add(title.name);
  if (link) shown.add(link.name);
  return element.attributes.filter((a) => !shown.has(a.name));
}

function renderChild(node: MdxNode): HTMLElement {
  if (node.kind === "text") return textBlock("mdx-card-text", node.value);

  const card = el("div", "mdx-card-item");
  const title = pick(node, TITLE_ATTRS);
  const head = el("div", "mdx-card-item-head");
  head.append(el("span", "mdx-card-item-name", title ?? node.name));
  if (title) head.append(el("span", "mdx-card-tag", node.name));
  card.append(head);

  const link = pick(node, LINK_ATTRS);
  if (link) card.append(el("span", "mdx-card-link", link));

  const summary = elementSummary(node);
  if (summary) card.append(textBlock("mdx-card-text", summary));

  const rest = restAttributes(node).filter((a) => !LINK_ATTRS.includes(a.name));
  if (rest.length > 0) card.append(renderAttributes(rest));

  for (const child of node.children) {
    if (child.kind === "element") card.append(renderChild(child));
  }
  return card;
}

function renderAttributes(attributes: MdxElement["attributes"]): HTMLElement {
  const list = el("dl", "mdx-card-attrs");
  for (const attribute of attributes) {
    list.append(el("dt", undefined, attribute.name));
    const value = el("dd", attribute.expression ? "is-expression" : undefined, attribute.value);
    list.append(value);
  }
  return list;
}

/**
 * The node view. Read-only as a card; "Edit source" swaps in a textarea holding
 * the block's own source, which is a far smaller surface than sending the
 * operator to the whole-document Raw MDX tab for one component.
 */
class MdxCardView implements NodeView {
  dom: HTMLElement;
  private editing = false;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private element: MdxElement,
  ) {
    this.dom = el("div", "mdx-card");
    this.dom.setAttribute("data-mdx-component", element.name);
    // An atom's interior is not editable text; without this ProseMirror would
    // try to place a cursor inside the card's markup.
    this.dom.contentEditable = "false";
    this.render();
  }

  private source(): string {
    return String(this.node.attrs.value ?? "");
  }

  private render(): void {
    this.dom.replaceChildren();
    this.dom.append(this.editing ? this.renderEditor() : this.renderCard());
  }

  private renderCard(): HTMLElement {
    const wrap = el("div", "mdx-card-body");

    const head = el("div", "mdx-card-head");
    head.append(el("span", "mdx-card-name", this.element.name));
    const edit = el("button", "mdx-card-edit", "Edit source");
    edit.type = "button";
    edit.addEventListener("click", () => {
      this.editing = true;
      this.render();
      this.dom.querySelector("textarea")?.focus();
    });
    head.append(edit);
    wrap.append(head);

    const rest = restAttributes(this.element);
    if (rest.length > 0) wrap.append(renderAttributes(rest));

    const children = el("div", "mdx-card-children");
    for (const child of this.element.children) children.append(renderChild(child));
    if (this.element.children.length > 0) wrap.append(children);

    return wrap;
  }

  private renderEditor(): HTMLElement {
    const wrap = el("div", "mdx-card-body");
    const head = el("div", "mdx-card-head");
    head.append(el("span", "mdx-card-name", this.element.name));

    const area = el("textarea", "mdx-card-source");
    area.value = this.source();
    area.rows = Math.min(20, this.source().split("\n").length + 1);
    area.spellcheck = false;

    const cancel = el("button", "mdx-card-edit", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      this.editing = false;
      this.render();
    });

    const done = el("button", "mdx-card-edit", "Done");
    done.type = "button";
    done.addEventListener("click", () => {
      const next = area.value;
      this.editing = false;
      // Only dispatch when the bytes actually differ: an open-and-close must
      // not mark the document dirty, the same rule the save path already keeps.
      if (next !== this.source()) {
        const pos = this.getPos();
        if (pos !== undefined) {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            value: next,
          });
          this.view.dispatch(tr);
          return; // the update triggers a fresh view
        }
      }
      this.render();
    });

    head.append(cancel, done);
    wrap.append(head, area);
    return wrap;
  }

  /** Keep the DOM out of ProseMirror's way while the textarea has focus. */
  stopEvent(): boolean {
    return this.editing;
  }

  ignoreMutation(): boolean {
    return true;
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const parsed = parseMdxElement(String(node.attrs.value ?? ""));
    // No longer a single component: hand back to the default view so the
    // operator sees their source rather than a card that no longer fits it.
    if (!parsed) return false;

    const changed = node.attrs.value !== this.node.attrs.value;
    this.node = node;
    this.element = parsed;
    // Re-render on a real change. Without this the DOM kept whatever it was
    // showing when the transaction was dispatched — which, after an edit, is
    // the source textarea, leaving the card stuck in editing state.
    if (changed) this.render();
    return true;
  }
}

/**
 * ProseMirror node views for the editor. Returns a card only for `html` nodes
 * that parse as exactly one component; everything else gets the default view.
 */
export const mdxNodeViews: Record<string, NodeViewConstructor> = {
  html: (node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
    const parsed = parseMdxElement(String(node.attrs.value ?? ""));
    // ProseMirror falls back to its default rendering when a node-view
    // constructor returns a falsy value, which is exactly what an unparseable
    // block should get. The published type is narrower than that behaviour, so
    // the cast records the gap rather than pretending a card was built.
    if (!parsed) return null as unknown as NodeView;
    return new MdxCardView(node, view, getPos, parsed);
  },
};
