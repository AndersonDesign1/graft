/**
 * The contents rail, drawn by Graft instead of fumadocs.
 *
 * Fumadocs' stock rail traces a line through every entry and bends it inward
 * at each h3, so its shape changed from page to page: straight on a page of
 * h2s, stepped and curved on one that nests. This rail is the same on every
 * page. One straight hairline track, entries indented by depth in their text
 * only, and an ink thumb that slides along the track to cover whatever part
 * of the page is on screen.
 *
 * Fumadocs still does the work that matters: AnchorProvider decides which
 * headings are active and TOCScrollArea keeps the active entry in view. This
 * file only draws. The container keeps fumadocs' id, grid area and widths so
 * the notebook layout places it exactly where the stock rail was.
 */
import * as Primitive from "fumadocs-core/toc";
import { TOCScrollArea, useTOCItems } from "fumadocs-ui/components/toc";
import type { TOCProps } from "fumadocs-ui/layouts/notebook/page/slots/toc";
import { type RefObject, useCallback, useEffect, useRef } from "react";

function Thumb({ list }: { list: RefObject<HTMLDivElement | null> }) {
  const thumb = useRef<HTMLDivElement>(null);
  const toc = Primitive.useTOC();

  const place = useCallback(
    (items: Primitive.TOCItemInfo[]) => {
      const element = thumb.current;
      const links = list.current?.querySelectorAll<HTMLElement>("a.toc-link");
      if (!element || !links) return;

      const first = items.findIndex((item) => item.active);
      const last = items.findLastIndex((item) => item.active);
      if (first === -1 || !links[first] || !links[last]) {
        element.style.opacity = "0";
        return;
      }

      const top = links[first].offsetTop;
      const bottom = links[last].offsetTop + links[last].offsetHeight;
      element.style.opacity = "1";
      element.style.transform = `translateY(${top}px)`;
      element.style.height = `${bottom - top}px`;
    },
    [list],
  );

  Primitive.useTOCListener(place);

  // Entries wrap differently as the rail resizes, which moves every offset.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => place(toc.get()));
    observer.observe(element);
    place(toc.get());
    return () => observer.disconnect();
  }, [list, place, toc]);

  return <div ref={thumb} className="toc-thumb" aria-hidden="true" />;
}

export function TOCRail({ container, header, footer }: TOCProps) {
  const items = useTOCItems();
  const list = useRef<HTMLDivElement>(null);

  if (items.length === 0 && !header && !footer) {
    return <div id="nd-toc-placeholder" className="hidden xl:layout:[--fd-toc-width:268px]" />;
  }

  return (
    <div
      id="nd-toc"
      {...container}
      className="sticky top-(--fd-docs-row-3) [grid-area:toc] h-[calc(var(--fd-docs-height)-var(--fd-docs-row-3))] flex flex-col w-(--fd-toc-width) pt-12 pe-4 pb-2 xl:layout:[--fd-toc-width:268px] max-xl:hidden"
    >
      {header}
      <h3 id="toc-title" className="text-sm">
        On this page
      </h3>
      {items.length > 0 && (
        <TOCScrollArea>
          <div ref={list} className="toc-rail">
            <Thumb list={list} />
            {items.map((item) => (
              <Primitive.TOCItem
                key={item.url}
                href={item.url}
                className="toc-link"
                data-depth={item.depth}
              >
                {item.title}
              </Primitive.TOCItem>
            ))}
          </div>
        </TOCScrollArea>
      )}
      {footer}
    </div>
  );
}
