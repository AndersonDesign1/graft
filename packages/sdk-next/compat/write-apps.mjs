// Generator for the compat app folders, one per supported Next major. Kept so
// they stay identical except for the versions they pin. When a pin moves, edit
// it here, run `node packages/sdk-next/compat/write-apps.mjs` from anywhere,
// then `pnpm install`.
//
// `--check` writes nothing and exits 1 if a committed file differs from what
// this would write, or an app folder exists that it would not write. The
// sdk-next tests run it, so a pin edited here without regenerating fails CI
// instead of the smoke quietly testing the old one. JSON is compared by value,
// because the repo formatter lays committed JSON out its own way.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const check = process.argv.includes("--check");

const majors = {
  // TypeScript 5 for 15: it writes moduleResolution "node" into a new
  // tsconfig, which TypeScript 6 rejects. Apps on 15 run TypeScript 5.
  next15: {
    next: "15.5.27",
    react: "19.2.8",
    types: "19.2.18",
    typesDom: "19.2.5",
    port: 3115,
    ts: "5.9.3",
  },
  next16: { next: "16.3.8", react: "19.2.8", types: "19.2.18", typesDom: "19.2.5", port: 3116 },
};

/** Every file this generator owns, by path relative to compat/. */
const files = new Map();

for (const [name, v] of Object.entries(majors)) {
  const pkg = {
    name: `sdk-next-compat-${name}`,
    version: "0.0.0",
    private: true,
    description: `A real Next.js ${v.next} app that runs @usegraft/sdk-next. See ../smoke.mjs.`,
    type: "module",
    scripts: { smoke: `node ../smoke.mjs --port ${v.port}` },
    dependencies: {
      "@usegraft/core": "workspace:*",
      "@usegraft/db": "workspace:*",
      "@usegraft/sdk-next": "workspace:*",
      next: v.next,
      react: v.react,
      "react-dom": v.react,
    },
    devDependencies: {
      "@types/node": "^22.20.1",
      "@types/react": v.types,
      "@types/react-dom": v.typesDom,
      "@usegraft/cli": "workspace:*",
      ...(v.ts ? { typescript: v.ts } : {}),
    },
    // A copy of the adapter, not a symlink, so its own `import "next/cache"`
    // resolves to this app's Next and not the workspace's.
    dependenciesMeta: { "@usegraft/sdk-next": { injected: true } },
  };
  files.set(`${name}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
  files.set(
    `${name}/next.config.mjs`,
    `import { withGraft } from "@usegraft/sdk-next/config";\n\nexport default withGraft({});\n`,
  );
  // The guide's code blocks, checked against this app's Next and React.
  // `paths` applies to every import in the program, so the adapter's own
  // source (mapped by the guide config) also sees this Next.
  const guide = name === "next16" ? "tsconfig.next16.json" : "tsconfig.json";
  // What next-env.d.ts gives a real app: Next's global types.
  files.set(`${name}/guide-env.d.ts`, '/// <reference types="next" />\n');
  const tsGuide = {
    extends: `../../guide/${guide}`,
    include: ["./guide-env.d.ts", "../../guide/**/*.ts", "../../guide/**/*.tsx"],
    ...(name === "next16" ? {} : { exclude: ["../../guide/next16"] }),
    compilerOptions: {
      paths: {
        "@/*": ["../../guide/*"],
        "@usegraft/sdk-next": ["../../src/index.ts"],
        "@usegraft/sdk-next/config": ["../../src/next-config.ts"],
        next: ["./node_modules/next"],
        "next/*": ["./node_modules/next/*"],
        react: ["./node_modules/@types/react"],
        "react/*": ["./node_modules/@types/react/*"],
        "react-dom": ["./node_modules/@types/react-dom"],
        "react-dom/*": ["./node_modules/@types/react-dom/*"],
      },
    },
  };
  files.set(`${name}/tsconfig.guide.json`, `${JSON.stringify(tsGuide, null, 2)}\n`);
}

/** Same content: by value for JSON, by text otherwise. */
function matches(path, committed, generated) {
  if (path.endsWith(".json"))
    return isDeepStrictEqual(JSON.parse(committed), JSON.parse(generated));
  return committed.replaceAll("\r\n", "\n") === generated;
}

if (check) {
  const problems = [];
  for (const [path, content] of files) {
    const file = `${here}${path}`;
    if (!existsSync(file)) problems.push(`missing: ${path}`);
    else if (!matches(path, readFileSync(file, "utf8"), content)) problems.push(`differs: ${path}`);
  }
  // An app folder this generator no longer writes, such as a dropped major,
  // would still be a workspace package with its own pins.
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (entry.isDirectory() && /^next\d+$/.test(entry.name) && !(entry.name in majors))
      problems.push(`not generated: ${entry.name}/`);
  }
  if (problems.length > 0) {
    console.error("compat apps do not match write-apps.mjs:");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("Run: node packages/sdk-next/compat/write-apps.mjs, then pnpm install.");
    process.exit(1);
  }
  console.log(`compat apps match write-apps.mjs (${Object.keys(majors).join(", ")})`);
} else {
  for (const [path, content] of files) {
    mkdirSync(`${here}${path.split("/")[0]}`, { recursive: true });
    writeFileSync(`${here}${path}`, content);
  }
  console.log("wrote", Object.keys(majors).join(", "));
}
