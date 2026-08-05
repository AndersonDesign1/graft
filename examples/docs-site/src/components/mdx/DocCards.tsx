/**
 * Path / explore cards for docs hubs — title + one-line + href.
 * Hairline grid styled like the Why pillars (not generic SaaS cards).
 */
import type { ReactNode } from "react";

export interface DocCardProps {
  title: string;
  href: string;
  children?: ReactNode;
}

export function DocCard({ title, href, children }: DocCardProps) {
  return (
    <a className="doc-card" href={href}>
      <span className="doc-card-title">{title}</span>
      {children ? <span className="doc-card-body">{children}</span> : null}
    </a>
  );
}

export function DocCards({ children }: { children: ReactNode }) {
  return <div className="doc-cards">{children}</div>;
}
