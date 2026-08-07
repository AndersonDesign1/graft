/**
 * The guard that stops autosave rewriting files nobody edited.
 *
 * This is not a hypothetical: with it removed, clicking through the content
 * tree reformatted every document on the way past, because the editor
 * re-serialises markdown on mount and that looks exactly like an edit.
 */
import { describe, expect, it, vi } from "vitest";
import { HUMAN_EDIT_EVENTS, watchEditIntent } from "./edit-intent";

/** Node's own EventTarget — enough to exercise this without a DOM. */
const node = () => new EventTarget();

describe("watchEditIntent", () => {
  it("starts untouched, so a mount-time change event is ignored", () => {
    expect(watchEditIntent(node()).touched).toBe(false);
  });

  it("stays untouched for events the editor raises on its own", () => {
    const host = node();
    const intent = watchEditIntent(host);
    // Focus, selection and mutation all fire without anyone typing.
    for (const type of ["focus", "blur", "selectionchange", "input", "scroll"]) {
      host.dispatchEvent(new Event(type));
    }
    expect(intent.touched).toBe(false);
  });

  it.each(HUMAN_EDIT_EVENTS)("marks touched on %s", (type) => {
    const host = node();
    const intent = watchEditIntent(host);
    host.dispatchEvent(new Event(type));
    expect(intent.touched).toBe(true);
  });

  it("stays touched once armed", () => {
    const host = node();
    const intent = watchEditIntent(host);
    host.dispatchEvent(new Event("beforeinput"));
    host.dispatchEvent(new Event("focus"));
    expect(intent.touched).toBe(true);
  });

  it("listens in the capture phase, since editors stop propagation", () => {
    const host = node();
    const spy = vi.spyOn(host, "addEventListener");
    watchEditIntent(host);
    expect(spy).toHaveBeenCalledTimes(HUMAN_EDIT_EVENTS.length);
    for (const call of spy.mock.calls) expect(call[2]).toMatchObject({ capture: true });
  });

  it("goes deaf after dispose, and disposes idempotently", () => {
    const host = node();
    const intent = watchEditIntent(host);
    intent.dispose();
    intent.dispose();
    host.dispatchEvent(new Event("beforeinput"));
    expect(intent.touched).toBe(false);
  });
});
