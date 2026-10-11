/**
 * Menu — Base UI, wrapped in shadcn's part-per-export shape.
 *
 * Worth the dependency rather than a hand-rolled dropdown: focus trapping,
 * roving tabindex, typeahead, escape/outside-press and correct ARIA are all
 * things a bespoke menu gets subtly wrong, and the branch switcher is the
 * most-used control in the Studio.
 */
import { Menu as MenuPrimitive } from "@base-ui-components/react/menu";
import { cx } from "../../lib/cn";

export const Menu = MenuPrimitive.Root;

export function MenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  // No base class: the trigger is styled by whatever the caller is (a chip, an
  // icon button), so it only carries the slot.
  return <MenuPrimitive.Trigger data-slot="menu-trigger" className={className} {...props} />;
}

export function MenuContent({
  className,
  align = "start",
  side,
  sideOffset = 6,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  side?: MenuPrimitive.Positioner.Props["side"];
  sideOffset?: number;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        {...(side ? { side } : {})}
        sideOffset={sideOffset}
        className="menu-positioner"
      >
        {/* Base UI hands us the trigger's position as --transform-origin, so
            the popup scales out of the control rather than its own centre. */}
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cx("menu", className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item data-slot="menu-item" className={cx("menu-item", className)} {...props} />
  );
}

/**
 * A labelled run of items. The label and its items travel together because
 * Base UI only renders a group label inside a `Menu.Group`; a bare label
 * throws (error #31) and, with nothing above it to catch the error, unmounts
 * the whole Studio. There is no standalone label export, so that cannot be
 * written by accident.
 */
export function MenuSection({
  label,
  children,
  className,
  ...props
}: MenuPrimitive.Group.Props & { label: React.ReactNode }) {
  return (
    <MenuPrimitive.Group data-slot="menu-group" className={className} {...props}>
      <MenuPrimitive.GroupLabel data-slot="menu-label" className="menu-label">
        {label}
      </MenuPrimitive.GroupLabel>
      {children}
    </MenuPrimitive.Group>
  );
}

export function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cx("menu-separator", className)}
      {...props}
    />
  );
}
