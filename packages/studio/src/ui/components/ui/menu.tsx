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
export const MenuGroup = MenuPrimitive.Group;

export function MenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  // No base class: the trigger is styled by whatever the caller is (a chip, an
  // icon button), so it only carries the slot.
  return <MenuPrimitive.Trigger data-slot="menu-trigger" className={className} {...props} />;
}

export function MenuContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: number;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="menu-positioner">
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
  return <MenuPrimitive.Item data-slot="menu-item" className={cx("menu-item", className)} {...props} />;
}

export function MenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-label"
      className={cx("menu-label", className)}
      {...props}
    />
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
