"use client";

/**
 * In-view gate: adds `in` to the child wrapper's class list once it enters
 * the viewport (one-shot). All motion is CSS — this only flips a class, so
 * prefers-reduced-motion is honored entirely in the stylesheet.
 */
import { useEffect, useRef, useState } from "react";

/**
 * `threshold` is what you want for anything that *plays* (a type-out, a draw-on)
 * rather than merely fades in. A rootMargin is measured against the viewport, so
 * on a short laptop screen it can fire while only a sliver of a tall element is
 * on-screen — the animation then finishes below the fold and the user never sees
 * it. A threshold is measured against the *element*, so it is viewport-independent.
 */
export function useInView<T extends HTMLElement>(margin = "-80px", threshold = 0) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, threshold]);

  return { ref, inView };
}

export function Reveal({
  as: Tag = "div",
  delay = 0,
  className = "",
  children,
}: {
  as?: "div" | "section" | "figure" | "ul" | "p";
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- polymorphic ref
      ref={ref as any}
      className={`reveal ${inView ? "in" : ""} ${className}`}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
