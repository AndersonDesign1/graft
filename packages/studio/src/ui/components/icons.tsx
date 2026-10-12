/**
 * Icons: Lucide, re-exported under Studio names. The same set the docs use.
 *
 * Indirection on purpose: components import `IconCompile`, not
 * `RefreshCwIcon`. Swapping a glyph is one line here, the same discipline the
 * colour tokens follow. Size (16px) and stroke (1.75) are set once by
 * `LucideProvider` in app.tsx, so a component passes `size` only when it
 * means something smaller.
 *
 * Named imports from the package root: Vite tree-shakes them, so the bundle
 * carries only the glyphs listed here.
 */

// shell / navigation
export {
  HouseIcon as IconHome,
  ActivityIcon as IconOverview,
  FilesIcon as IconCollections,
  BracesIcon as IconSchema,
  ShieldCheckIcon as IconApprovals,
  GitBranchIcon as IconBranches,
  HistoryIcon as IconHistory,
  FileDiffIcon as IconChanges,
  SettingsIcon as IconSettings,
  MenuIcon as IconMenu,
} from "lucide-react";

// actions
export {
  RefreshCwIcon as IconCompile,
  BoxIcon as IconComponentBlock,
  SearchIcon as IconSearch,
  ChevronRightIcon as IconChevron,
  ChevronDownIcon as IconCaretDown,
  ChevronsUpDownIcon as IconCaretUpDown,
  XIcon as IconClose,
  CheckIcon as IconCheck,
  CopyIcon as IconCopy,
  ExternalLinkIcon as IconExternal,
  ArrowUpDownIcon as IconSort,
  PanelLeftIcon as IconSidebar,
  PanelRightIcon as IconInspector,
  Undo2Icon as IconRevert,
  PlusIcon as IconPlus,
  EllipsisIcon as IconMore,
  Trash2Icon as IconTrash,
  CodeIcon as IconCode,
  ArrowLeftIcon as IconBack,
  GitCommitHorizontalIcon as IconCommit,
  CopyPlusIcon as IconDuplicate,
  LinkIcon as IconLink,
  LogOutIcon as IconSignOut,
} from "lucide-react";

// status / meaning
export {
  TriangleAlertIcon as IconWarning,
  CircleAlertIcon as IconError,
  ShieldAlertIcon as IconWaiting,
  DatabaseIcon as IconDatabase,
  FileTextIcon as IconFile,
  NewspaperIcon as IconArticle,
  MonitorIcon as IconSystem,
  SunIcon as IconSun,
  MoonIcon as IconMoon,
  KeyboardIcon as IconKeyboard,
  PlugIcon as IconConnection,
  PaletteIcon as IconPalette,
  InfoIcon as IconInfo,
  LayersIcon as IconStack,
} from "lucide-react";

export type { LucideIcon as IconComponent } from "lucide-react";
