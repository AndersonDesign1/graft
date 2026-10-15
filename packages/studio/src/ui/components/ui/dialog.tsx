/**
 * Dialog: Base UI. The create dialog, the commit sheet, a compilation's
 * detail and the command palette.
 *
 * Base UI handles the parts that are easy to get wrong by hand: focus is
 * trapped and restored to the trigger, the page behind is inert, scroll is
 * locked, and Escape/outside-press close.
 *
 * Every dialog has a visible close button, top right, because Escape is not
 * something everyone knows to press. The palette opts out: it is a search
 * field that closes on Escape or on choosing a result.
 */
import { Dialog as DialogPrimitive } from "@base-ui-components/react/dialog";
import { cx } from "../../lib/cn";
import { IconClose } from "../icons";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  close = true,
  ...props
}: DialogPrimitive.Popup.Props & { close?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop data-slot="dialog-backdrop" className="dialog-backdrop" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cx("dialog", className)}
        {...props}
      >
        {children}
        {close ? (
          <DialogPrimitive.Close className="icon-btn dialog-close" aria-label="Close">
            <IconClose />
          </DialogPrimitive.Close>
        ) : null}
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
