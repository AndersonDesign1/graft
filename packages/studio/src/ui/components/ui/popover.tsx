/**
 * Popover — Base UI. For pickers that hold their own input (the reference
 * picker), where a Menu's typeahead and roving focus would fight the search
 * box.
 */
import { Popover as PopoverPrimitive } from "@base-ui-components/react/popover";
import { cx } from "../../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: number;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        className="menu-positioner"
      >
        {/* Scales out of its trigger: Base UI hands over --transform-origin. */}
        <PopoverPrimitive.Popup className={cx("popover", className)} {...props} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
