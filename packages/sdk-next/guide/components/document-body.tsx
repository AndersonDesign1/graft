import type { ReactNode } from "react";
import { MdxBody } from "@usegraft/sdk-next";

const components = {
  Callout: ({ title, children }: { title?: string; children: ReactNode }) => (
    <aside className="callout">
      {title && <strong>{title}</strong>}
      {children}
    </aside>
  ),
};

export function DocumentBody({ source }: { source: string }) {
  return <MdxBody source={source} components={components} />;
}
