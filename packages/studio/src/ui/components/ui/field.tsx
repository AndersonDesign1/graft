/**
 * Form controls — Base UI Field/Input/Switch/NumberField.
 *
 * Frontmatter is typed, so the editor should be too: a boolean gets a switch,
 * a number gets a stepper that refuses letters, and long strings get a
 * textarea. Rendering everything as a bare text input — which is what this
 * replaced — throws that type information away and makes every value a
 * string the user has to re-type correctly.
 */
import { Field as FieldPrimitive } from "@base-ui-components/react/field";
import { Input as InputPrimitive } from "@base-ui-components/react/input";
import { NumberField as NumberFieldPrimitive } from "@base-ui-components/react/number-field";
import { Switch as SwitchPrimitive } from "@base-ui-components/react/switch";
import { cn, cx } from "../../lib/cn";

export function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return <FieldPrimitive.Root data-slot="field" className={cx("field", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label data-slot="field-label" className={cx("field-label", className)} {...props} />
  );
}

export function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cx("field-hint", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputPrimitive.Props) {
  return <InputPrimitive data-slot="input" className={cx("input", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  // Plain DOM element, so className is a string — no state form to compose.
  return <textarea data-slot="textarea" className={cn("input textarea", className)} {...props} />;
}

export function NumberField({
  className,
  ...props
}: NumberFieldPrimitive.Root.Props) {
  return (
    <NumberFieldPrimitive.Root data-slot="number-field" className={cx("number-field", className)} {...props}>
      <NumberFieldPrimitive.Group className="number-field-group">
        <NumberFieldPrimitive.Decrement className="number-field-step" aria-label="Decrease">
          −
        </NumberFieldPrimitive.Decrement>
        <NumberFieldPrimitive.Input className="input number-field-input" />
        <NumberFieldPrimitive.Increment className="number-field-step" aria-label="Increase">
          +
        </NumberFieldPrimitive.Increment>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );
}

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cx("switch", className)} {...props}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
