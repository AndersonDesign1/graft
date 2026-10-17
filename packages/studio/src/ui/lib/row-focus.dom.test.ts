// @vitest-environment jsdom
/**
 * moveRowFocus and isTyping against a real DOM: which element holds focus,
 * and what is around it, decide whether a key moves a row. The pure nextRow
 * cases live in row-focus.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTyping, moveRowFocus } from "./row-focus";

function table(rows: number): HTMLTableElement {
  const el = document.createElement("table");
  for (let i = 0; i < rows; i++) {
    const tr = el.insertRow();
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("aria-label", `Select row ${i}`);
    tr.insertCell().append(box);
    const link = document.createElement("a");
    link.href = `#/c/products/p${i}`;
    link.className = "row-title";
    link.textContent = `Product ${i}`;
    tr.insertCell().append(link);
  }
  document.body.append(el);
  return el;
}

function key(key: string, target: EventTarget | null = document.activeElement, mods = {}) {
  return { key, altKey: false, ctrlKey: false, metaKey: false, target, ...mods };
}

const titles = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("a.row-title")];

beforeEach(() => {
  // jsdom has no layout, so scrollIntoView is missing.
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("moveRowFocus", () => {
  it("moves from no focus to the first row, then down and up", () => {
    const el = table(3);
    expect(moveRowFocus(el, "a.row-title", key("j", document.body))).toBe(true);
    expect(document.activeElement).toBe(titles(el)[0]);
    moveRowFocus(el, "a.row-title", key("ArrowDown"));
    expect(document.activeElement).toBe(titles(el)[1]);
    moveRowFocus(el, "a.row-title", key("k"));
    expect(document.activeElement).toBe(titles(el)[0]);
  });

  it("moves from a row's checkbox to the next row, not back to the first", () => {
    const el = table(3);
    const box = el.rows[1]?.querySelector("input");
    box?.focus();
    expect(moveRowFocus(el, "a.row-title", key("ArrowDown", box))).toBe(true);
    expect(document.activeElement).toBe(titles(el)[2]);
  });

  it("jumps with Home and End", () => {
    const el = table(4);
    titles(el)[1]?.focus();
    moveRowFocus(el, "a.row-title", key("End"));
    expect(document.activeElement).toBe(titles(el)[3]);
    moveRowFocus(el, "a.row-title", key("Home"));
    expect(document.activeElement).toBe(titles(el)[0]);
  });

  it("leaves j and k to a field being typed in, and every key with a modifier", () => {
    const el = table(2);
    const search = document.createElement("input");
    document.body.append(search);
    search.focus();
    expect(moveRowFocus(el, "a.row-title", key("j", search))).toBe(false);
    expect(document.activeElement).toBe(search);
    titles(el)[0]?.focus();
    expect(moveRowFocus(el, "a.row-title", key("ArrowDown", undefined, { metaKey: true }))).toBe(
      false,
    );
    expect(document.activeElement).toBe(titles(el)[0]);
  });
});

describe("isTyping", () => {
  it("is true in a field and on anything inside a confirm dialog", () => {
    const input = document.createElement("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const confirm = document.createElement("button");
    dialog.append(confirm);
    const plain = document.createElement("button");
    document.body.append(input, dialog, plain);
    expect(isTyping(input)).toBe(true);
    expect(isTyping(confirm)).toBe(true);
    expect(isTyping(plain)).toBe(false);
  });

  it("is false on a row's checkbox and true on a checkbox in a dialog", () => {
    const el = table(1);
    const rowBox = el.querySelector("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogBox = document.createElement("input");
    dialogBox.type = "checkbox";
    dialog.append(dialogBox);
    document.body.append(dialog);
    expect(isTyping(rowBox)).toBe(false);
    expect(isTyping(dialogBox)).toBe(true);
  });
});
