/**
 * Icons — Phosphor, re-exported under Studio names.
 *
 * Indirection on purpose: components import `IconCompile`, not
 * `ArrowsClockwise`. Swapping a glyph (or the whole set) is one line here,
 * the same discipline the colour tokens follow.
 *
 * Imported per-icon from `dist/icons/*` rather than the package barrel. The
 * barrel re-exports ~1,500 glyphs and pulls the lot into the bundle; the deep
 * paths cost ~1 kB each. Weight and size are set once via IconContext in
 * app.tsx, so "regular" at 16px sits correctly against the 1px hairlines.
 */

// shell / navigation
export { SquaresFour as IconOverview } from "@phosphor-icons/react/dist/icons/SquaresFour";
export { Files as IconCollections } from "@phosphor-icons/react/dist/icons/Files";
export { TreeStructure as IconSchema } from "@phosphor-icons/react/dist/icons/TreeStructure";
export { SealCheck as IconApprovals } from "@phosphor-icons/react/dist/icons/SealCheck";
export { GitBranch as IconBranches } from "@phosphor-icons/react/dist/icons/GitBranch";
export { ClockCounterClockwise as IconHistory } from "@phosphor-icons/react/dist/icons/ClockCounterClockwise";
export { GitDiff as IconChanges } from "@phosphor-icons/react/dist/icons/GitDiff";
export { GearSix as IconSettings } from "@phosphor-icons/react/dist/icons/GearSix";

// actions
export { ArrowsClockwise as IconCompile } from "@phosphor-icons/react/dist/icons/ArrowsClockwise";
export { Cube as IconComponentBlock } from "@phosphor-icons/react/dist/icons/Cube";
export { MagnifyingGlass as IconSearch } from "@phosphor-icons/react/dist/icons/MagnifyingGlass";
export { CaretRight as IconChevron } from "@phosphor-icons/react/dist/icons/CaretRight";
export { CaretDown as IconCaretDown } from "@phosphor-icons/react/dist/icons/CaretDown";
export { CaretUpDown as IconCaretUpDown } from "@phosphor-icons/react/dist/icons/CaretUpDown";
export { X as IconClose } from "@phosphor-icons/react/dist/icons/X";
export { Check as IconCheck } from "@phosphor-icons/react/dist/icons/Check";
export { Copy as IconCopy } from "@phosphor-icons/react/dist/icons/Copy";
export { ArrowSquareOut as IconExternal } from "@phosphor-icons/react/dist/icons/ArrowSquareOut";
export { SortAscending as IconSort } from "@phosphor-icons/react/dist/icons/SortAscending";
export { Sidebar as IconSidebar } from "@phosphor-icons/react/dist/icons/Sidebar";
export { ArrowCounterClockwise as IconRevert } from "@phosphor-icons/react/dist/icons/ArrowCounterClockwise";

// status / meaning
export { Warning as IconWarning } from "@phosphor-icons/react/dist/icons/Warning";
export { Database as IconDatabase } from "@phosphor-icons/react/dist/icons/Database";
export { FileText as IconFile } from "@phosphor-icons/react/dist/icons/FileText";
export { Monitor as IconSystem } from "@phosphor-icons/react/dist/icons/Monitor";
export { Sun as IconSun } from "@phosphor-icons/react/dist/icons/Sun";
export { Moon as IconMoon } from "@phosphor-icons/react/dist/icons/Moon";
export { Keyboard as IconKeyboard } from "@phosphor-icons/react/dist/icons/Keyboard";
export { Plugs as IconConnection } from "@phosphor-icons/react/dist/icons/Plugs";
export { Palette as IconPalette } from "@phosphor-icons/react/dist/icons/Palette";
export { Info as IconInfo } from "@phosphor-icons/react/dist/icons/Info";
export { Stack as IconStack } from "@phosphor-icons/react/dist/icons/Stack";

export type { Icon as IconComponent } from "@phosphor-icons/react";
