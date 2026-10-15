/**
 * Tooltip: Base UI. Names an icon-only button and shows its shortcut.
 *
 * Never the only place a word lives: the button keeps its aria-label, so a
 * screen reader and a touch screen lose nothing when the tooltip never shows.
 * Opens on hover after a short delay and on keyboard focus at once.
 */
import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  label,
  shortcut,
  children,
  side = "bottom",
}: {
  label: string;
  /** Keys, shown as `kbd`: ["⌘", "K"]. */
  shortcut?: readonly string[];
  /** The trigger: one element that accepts a ref and props (a button). */
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom" | "left" | "right";
}): ReactNode {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="menu-positioner">
          <TooltipPrimitive.Popup className="tooltip">
            {label}
            {shortcut?.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
