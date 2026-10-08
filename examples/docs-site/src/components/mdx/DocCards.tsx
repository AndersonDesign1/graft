import type { ReactNode } from "react";
import { frameworkIcons } from "../icons/FrameworkIcons";

export interface DocCardProps {
  title: string;
  href: string;
  icon?: string | ReactNode;
  children?: ReactNode;
}

export function DocCard({ title, href, icon, children }: DocCardProps) {
  let renderedIcon: ReactNode = null;
  if (typeof icon === "string") {
    const IconComp = frameworkIcons[icon.toLowerCase()];
    if (IconComp) {
      renderedIcon = <IconComp size={22} className="doc-card-icon" />;
    }
  } else if (icon) {
    renderedIcon = icon;
  }

  return (
    <a className="doc-card" href={href}>
      <div className="doc-card-header">
        {renderedIcon ? <div className="doc-card-icon-wrap">{renderedIcon}</div> : null}
        <span className="doc-card-title">{title}</span>
      </div>
      {children ? <span className="doc-card-body">{children}</span> : null}
    </a>
  );
}

export function DocCards({ children }: { children: ReactNode }) {
  return <div className="doc-cards">{children}</div>;
}
