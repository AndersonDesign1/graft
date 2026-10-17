/**
 * Button — shadcn's structure on Base UI.
 *
 * Follows the shadcn convention: variants are props with defaults, every part
 * carries a `data-slot`, and the variant resolves to a *semantic* class name
 * rather than a pile of utilities. That is what lets the CSS token layers own
 * the appearance while this file owns the API.
 */
import { Button as ButtonPrimitive } from "@base-ui-components/react/button";
import { useId } from "react";
import { cx } from "../../lib/cn";
import { Tooltip } from "./tooltip";

export type ButtonVariant = "default" | "primary" | "outline" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "sm" | "xs" | "icon" | "icon-sm";

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cx("btn", className)}
      {...props}
    />
  );
}

/**
 * A button that can't be used right now and says why. A `disabled` button
 * takes no focus and no hover, so a `title` on it was the only place the
 * reason lived, and few people ever saw it. With a reason, the button stays
 * focusable (and refuses the click), the reason shows on hover and focus,
 * and a screen reader hears it as the button's description.
 */
export function ReasonedButton({
  reason,
  disabled,
  ...props
}: ButtonPrimitive.Props & { variant?: ButtonVariant; size?: ButtonSize; reason?: string }) {
  const id = useId();
  if (reason === undefined) return <Button disabled={disabled} {...props} />;
  return (
    <>
      <Tooltip label={reason}>
        <Button {...props} disabled focusableWhenDisabled aria-describedby={id} />
      </Tooltip>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </>
  );
}
