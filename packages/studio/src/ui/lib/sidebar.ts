import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "graft-studio-sidebar";
const MIN = 200;
const MAX = 420;
const DEFAULT = 264;

/**
 * Draggable sidebar width, persisted.
 *
 * The sidebar holds the content tree now, so how much of a document title
 * fits is a real preference — deep section names want more room, a small
 * screen wants less. Pointer capture keeps the drag alive when the cursor
 * outruns the 4px handle.
 */
export function useSidebarWidth(): {
  width: number;
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  reset: () => void;
} {
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(KEY));
    return Number.isFinite(stored) && stored >= MIN && stored <= MAX ? stored : DEFAULT;
  });
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      /* private mode — the width still applies for this session */
    }
  }, [width]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);

    const move = (e: PointerEvent): void => {
      // Coalesce to one update per frame; the raw stream fires far faster
      // than the layout can settle.
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        setWidth(Math.min(MAX, Math.max(MIN, e.clientX)));
      });
    };
    const up = (): void => {
      setDragging(false);
      cancelAnimationFrame(frame.current);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }, []);

  const reset = useCallback(() => setWidth(DEFAULT), []);

  return { width, dragging, onPointerDown, reset };
}
