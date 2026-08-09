/**
 * Dialog — Base UI. Used for the command palette and detail drawers.
 *
 * Base UI handles the parts that are easy to get wrong by hand: focus is
 * trapped and restored to the trigger, the page behind is inert, scroll is
 * locked, and Escape/outside-press close.
 */
import { Dialog as DialogPrimitive } from "@base-ui-components/react/dialog";
import { cx } from "../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop data-slot="dialog-backdrop" className="dialog-backdrop" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cx("dialog", className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cx("dialog-title", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cx("dialog-description", className)}
      {...props}
    />
  );
}
