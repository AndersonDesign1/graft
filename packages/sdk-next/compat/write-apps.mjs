// One-off generator for the three compat app folders. Kept so the three stay
// identical except for the versions they pin. Run: node compat/write-apps.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const majors = {
  // TypeScript 5 for 14 and 15: both write moduleResolution "node" into a new
  // tsconfig, which TypeScript 6 rejects. Apps on those majors run TypeScript 5.
  next14: {
    next: "14.2.35",
    react: "18.3.1",
    types: "18.3.31",
    typesDom: "18.3.7",
    port: 3114,
    ts: "5.9.3",
  },
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

for (const [name, v] of Object.entries(majors)) {
  const dir = `${here}${name}/`;
  mkdirSync(dir, { recursive: true });
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
  writeFileSync(`${dir}package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(
    `${dir}next.config.mjs`,
    `// .mjs because Next 14 cannot load next.config.ts.\nimport { withGraft } from "@usegraft/sdk-next/config";\n\nexport default withGraft({});\n`,
  );
  // The guide's code blocks, checked against this app's Next and React.
  // \`paths\` applies to every import in the program, so the adapter's own
  // source (mapped by the guide config) also sees this Next.
  const guide = name === "next16" ? "tsconfig.next16.json" : "tsconfig.json";
  // What next-env.d.ts gives a real app: Next's types, which pull in React's
  // canary types. Those are what let an async Server Component (like MdxBody)
  // be used as JSX on React 18. Next references them from its own folder,
  // which under pnpm can reach a different @types/react than this app's, so
  // they are referenced from here too, the way a flat node_modules resolves.
  writeFileSync(
    `${dir}guide-env.d.ts`,
    [
      '/// <reference types="next" />',
      '/// <reference types="react/canary" />',
      '/// <reference types="react-dom/canary" />',
      "",
    ].join("\n"),
  );
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
  writeFileSync(`${dir}tsconfig.guide.json`, `${JSON.stringify(tsGuide, null, 2)}\n`);
}
console.log("wrote", Object.keys(majors).join(", "));
