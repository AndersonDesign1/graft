/**
 * Tabs — Base UI. The segmented controls (editor mode, list filters).
 *
 * `Tabs.Indicator` is the reason to use the primitive: Base UI measures the
 * active tab and exposes its position/size as CSS variables, so the moving
 * highlight is one transformed element rather than a background swap on each
 * button — which is both smoother and interruptible mid-slide.
 */
import { Tabs as TabsPrimitive } from "@base-ui-components/react/tabs";
import { cx } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List data-slot="tabs-list" className={cx("segmented", className)} {...props} />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cx("segmented-tab", className)}
      {...props}
    />
  );
}

export function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cx("segmented-indicator", className)}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={className} {...props} />;
}
