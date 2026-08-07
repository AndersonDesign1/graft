/**
 * Button — shadcn's structure on Base UI.
 *
 * Follows the shadcn convention: variants are props with defaults, every part
 * carries a `data-slot`, and the variant resolves to a *semantic* class name
 * rather than a pile of utilities. That is what lets the CSS token layers own
 * the appearance while this file owns the API.
 */
import { Button as ButtonPrimitive } from "@base-ui-components/react/button";
import { cx } from "../../lib/cn";

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
