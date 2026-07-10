/**
 * planAdd / applyPlan — the two halves of `graft add`.
 *
 * planAdd is pure-ish (it reads item files + probes the target) and returns
 * everything that WOULD happen, so `--dry-run` can print it. applyPlan does the
 * writes: item files, then a regenerated `graft/index.ts` barrel (from whatever
 * modules end up on disk), then a regenerated MDX component map (from
 * components/*.tsx), then appended llms.txt fragments.
 *
 * Re-add friendliness: an existing file whose content is byte-identical is a
 * skip, not a conflict — so `graft add comments` twice, or two primitives that
 * share the `scoped-access` dependency, Just Work. A conflict is only an
 * existing file that DIFFERS; that's REGISTRY_FILE_EXISTS before any write
 * unless `--overwrite`. llms fragments dedupe by heading.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GraftError } from "@graft/contracts";
import { barrelSource } from "./barrel";
import type { RegistryItem } from "./manifest";
import { mdxComponentsSource } from "./mdx-map";
import { resolveItems, type ResolveOptions } from "./registry";

const GRAFT_DIR = "graft";
const COMPONENTS_DIR = "components";
const MDX_MAP_FILE = "mdx-components.ts";

export interface PlannedFile {
  /** Absolute path to write. */
  targetPath: string;
  /** Path relative to the project root — for display. */
  relPath: string;
  content: string;
  role: string;
  /** A file already exists at targetPath. */
  exists: boolean;
  /** The existing file is byte-identical to `content` (a no-op re-add). */
  identical: boolean;
}

export interface AddPlan {
  items: RegistryItem[];
  files: PlannedFile[];
  /** The regenerated barrel — always written (generated infra, never a conflict). */
  barrel: { targetPath: string; relPath: string; content: string };
  /**
   * The regenerated MDX component map. Present when the project has (or this
   * plan adds) any component-role files, or when components/ already exists.
   */
  mdxMap: { targetPath: string; relPath: string; content: string } | null;
  /** llms.txt fragments (one per item that ships one), appended if not already present. */
  llms: { targetPath: string; fragments: string[] };
  /** npm packages to ensure installed (union across items) — printed, not run. */
  npmDependencies: Record<string, string>;
  /** Existing files that DIFFER and would be overwritten (guarded at apply time). */
  conflicts: string[];
}

export interface PlanAddOptions extends ResolveOptions {
  /** Project root — the directory holding graft.config.ts. */
  targetDir: string;
}

/** Primitive module basenames already present under graft/ (excludes the barrel). */
function listGraftModules(graftDir: string): string[] {
  if (!existsSync(graftDir)) return [];
  return readdirSync(graftDir)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .map((f) => f.slice(0, -".ts".length));
}

/**
 * Component basenames under components/ for the MDX map.
 * Convention: only PascalCase `*.tsx` files (Callout.tsx, Faq.tsx) — skips
 * app helpers like page.tsx / contact-form.tsx and the generated map itself.
 */
export function listMdxComponents(componentsDir: string): string[] {
  if (!existsSync(componentsDir)) return [];
  return readdirSync(componentsDir)
    .filter((f) => f.endsWith(".tsx") && /^[A-Z]/.test(f))
    .map((f) => f.replace(/\.tsx$/, ""));
}

export function planAdd(names: readonly string[], options: PlanAddOptions): AddPlan {
  const { targetDir } = options;
  const items = resolveItems(names, options);

  const files: PlannedFile[] = [];
  const npmDependencies: Record<string, string> = {};
  const fragments: string[] = [];
  const newModules: string[] = [];
  const newComponents: string[] = [];

  for (const item of items) {
    Object.assign(npmDependencies, item.dependencies);
    for (const file of item.files) {
      const content = readFileSync(join(item.dir, file.source), "utf8");
      const targetPath = join(targetDir, file.target);
      const exists = existsSync(targetPath);
      const identical = exists && readFileSync(targetPath, "utf8") === content;
      files.push({ targetPath, relPath: file.target, content, role: file.role, exists, identical });
      if (file.role === "module") {
        // Only top-level graft/<name>.ts participates in the barrel.
        const parts = file.target.replace(/\\/g, "/").split("/");
        if (parts.length === 2 && parts[0] === GRAFT_DIR && parts[1]?.endsWith(".ts")) {
          newModules.push(basename(file.target).replace(/\.ts$/, ""));
        }
      }
      if (
        file.role === "component" &&
        file.target.replace(/\\/g, "/").startsWith(`${COMPONENTS_DIR}/`)
      ) {
        const base = basename(file.target).replace(/\.tsx$/, "");
        if (base !== "mdx-components") newComponents.push(base);
      }
    }
    if (item.llms) fragments.push(readFileSync(join(item.dir, item.llms), "utf8").trimEnd());
  }

  const graftDir = join(targetDir, GRAFT_DIR);
  const modules = [...new Set([...listGraftModules(graftDir), ...newModules])];

  const componentsDir = join(targetDir, COMPONENTS_DIR);
  const componentNames = [...new Set([...listMdxComponents(componentsDir), ...newComponents])];
  const touchesComponents =
    newComponents.length > 0 ||
    existsSync(componentsDir) ||
    existsSync(join(componentsDir, MDX_MAP_FILE));

  return {
    items,
    files,
    barrel: {
      targetPath: join(graftDir, "index.ts"),
      relPath: join(GRAFT_DIR, "index.ts"),
      content: barrelSource(modules),
    },
    mdxMap: touchesComponents
      ? {
          targetPath: join(componentsDir, MDX_MAP_FILE),
          relPath: join(COMPONENTS_DIR, MDX_MAP_FILE),
          content: mdxComponentsSource(componentNames),
        }
      : null,
    llms: { targetPath: join(targetDir, "llms.txt"), fragments },
    npmDependencies,
    conflicts: files.filter((f) => f.exists && !f.identical).map((f) => f.relPath),
  };
}

export interface ApplyResult {
  /** Files newly written or overwritten. */
  written: string[];
  /** Existing identical files left untouched. */
  skipped: string[];
  barrelPath: string;
  mdxMapPath: string | null;
  llmsAppended: boolean;
}

/** The heading a fragment dedupes on ("## name (primitive)"), or its first line. */
function fragmentHeading(fragment: string): string {
  const lines = fragment.split("\n");
  return lines.find((l) => l.startsWith("## ")) ?? lines[0] ?? fragment.slice(0, 24);
}

export function applyPlan(plan: AddPlan, options: { overwrite?: boolean } = {}): ApplyResult {
  if (!options.overwrite && plan.conflicts.length > 0) {
    throw new GraftError({
      code: "REGISTRY_FILE_EXISTS",
      message: `Adding ${plan.items.map((i) => i.name).join(", ")} would overwrite ${plan.conflicts.length} existing file(s) that differ: ${plan.conflicts.join(", ")}.`,
      fix: "Re-run with --overwrite to replace them, or move/rename those files first. `graft add --dry-run <item>` previews every path an item writes.",
      details: { conflicts: plan.conflicts },
    });
  }

  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of plan.files) {
    if (file.identical) {
      skipped.push(file.relPath);
      continue;
    }
    mkdirSync(dirname(file.targetPath), { recursive: true });
    writeFileSync(file.targetPath, file.content, "utf8");
    written.push(file.relPath);
  }

  // Regenerate the barrel from what is actually on disk (robust to manual edits).
  const graftDir = dirname(plan.barrel.targetPath);
  mkdirSync(graftDir, { recursive: true });
  writeFileSync(plan.barrel.targetPath, barrelSource(listGraftModules(graftDir)), "utf8");

  let mdxMapPath: string | null = null;
  if (plan.mdxMap) {
    const componentsDir = dirname(plan.mdxMap.targetPath);
    mkdirSync(componentsDir, { recursive: true });
    // Re-scan disk after writes so the map matches reality.
    writeFileSync(
      plan.mdxMap.targetPath,
      mdxComponentsSource(listMdxComponents(componentsDir)),
      "utf8",
    );
    mdxMapPath = plan.mdxMap.relPath;
  }

  let llmsAppended = false;
  const existing = existsSync(plan.llms.targetPath)
    ? readFileSync(plan.llms.targetPath, "utf8")
    : "";
  const fresh = plan.llms.fragments.filter(
    (f) => f.trim().length > 0 && !existing.includes(fragmentHeading(f)),
  );
  if (fresh.length > 0) {
    const separator = existing.trim().length > 0 ? "\n\n" : "";
    writeFileSync(
      plan.llms.targetPath,
      `${existing.trimEnd()}${separator}${fresh.join("\n\n")}\n`,
      "utf8",
    );
    llmsAppended = true;
  }

  return { written, skipped, barrelPath: plan.barrel.relPath, mdxMapPath, llmsAppended };
}
