/**
 * Hand-drawn icon set. Deliberately not an icon library: zero runtime weight,
 * and the house style is drawn rather than shopped (see the landing's graft
 * mark and chamfered MCP packets).
 *
 * All glyphs are stroked on a 16-unit grid at 1.5 width so they optically
 * match the 1px hairlines around them, and inherit `currentColor`.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Overview — a stack of measures, the "everything at a glance" mark. */
export const IconOverview = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12.5V9M6.5 12.5V4M10.5 12.5V7M14 12.5v-9" />
  </Svg>
);

/** Collections — pages in a stack. */
export const IconCollections = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.25" y="2.25" width="8.5" height="10" rx="1.25" />
    <path d="M5 13.25h6.25a1.5 1.5 0 0 0 1.5-1.5V4.5" />
    <path d="M4.75 5h3.5M4.75 7.5h3.5M4.75 10h2" />
  </Svg>
);

/** Schema — a node with its typed branches. */
export const IconSchema = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.75" cy="8" r="1.75" />
    <circle cx="12.25" cy="4" r="1.5" />
    <circle cx="12.25" cy="12" r="1.5" />
    <path d="M5.5 8h2.25a1.5 1.5 0 0 0 1.3-.75L10.9 4.9M5.5 8h2.25a1.5 1.5 0 0 1 1.3.75l1.85 2.35" />
  </Svg>
);

/** Approvals — a gate with a check. */
export const IconApprovals = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75 13.5 4v4.1c0 2.6-2.2 5-5.5 6.15C4.7 13.1 2.5 10.7 2.5 8.1V4z" />
    <path d="m5.9 8.1 1.5 1.5 2.9-3" />
  </Svg>
);

/** Branches — the graft fork. */
export const IconBranches = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="7" r="1.75" />
    <path d="M4.5 5.25v5.5M4.5 8.75h4a3 3 0 0 0 3-1.75" />
  </Svg>
);

/** History — a dial turned back. */
export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77" />
    <path d="M2.5 2.5v2.75h2.75" />
    <path d="M8 5.25V8l1.9 1.4" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.6M8 12.65v1.6M1.75 8h1.6M12.65 8h1.6M3.6 3.6l1.15 1.15M11.25 11.25l1.15 1.15M12.4 3.6l-1.15 1.15M4.75 11.25 3.6 12.4" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 3.5 4.5 4.5-4.5 4.5" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.25" cy="7.25" r="4.5" />
    <path d="m10.6 10.6 2.65 2.65" />
  </Svg>
);

/** Compile — the projection arrow: files into the index. */
export const IconCompile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.25v7.5" />
    <path d="m4.9 6.9 3.1 3.1 3.1-3.1" />
    <path d="M2.75 12.5h10.5" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.13 2.6 1.9 11.4a1 1 0 0 0 .87 1.5h10.46a1 1 0 0 0 .87-1.5L8.87 2.6a1 1 0 0 0-1.74 0Z" />
    <path d="M8 6.25v2.5M8 10.9v.1" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 8.4 3.2 3.2L13 4.8" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

/** Theme — the half-filled disc, the one control that shows both schemes. */
export const IconTheme = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconDatabase = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="8" cy="4" rx="5" ry="2.25" />
    <path d="M3 4v8c0 1.24 2.24 2.25 5 2.25s5-1.01 5-2.25V4" />
    <path d="M3 8c0 1.24 2.24 2.25 5 2.25s5-1.01 5-2.25" />
  </Svg>
);

export const IconFile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 1.75H4.5a1.25 1.25 0 0 0-1.25 1.25v10a1.25 1.25 0 0 0 1.25 1.25h7a1.25 1.25 0 0 0 1.25-1.25V5.5z" />
    <path d="M9 1.75V5.5h3.75" />
  </Svg>
);
