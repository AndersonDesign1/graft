// Generator for the compat app folders, one per supported Next major. Kept so
// they stay identical except for the versions they pin. When a pin moves, edit
// it here, run `node compat/write-apps.mjs`, then `pnpm install`.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

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
    `import { withGraft } from "@usegraft/sdk-next/config";\n\nexport default withGraft({});\n`,
  );
  // The guide's code blocks, checked against this app's Next and React.
  // `paths` applies to every import in the program, so the adapter's own
  // source (mapped by the guide config) also sees this Next.
  const guide = name === "next16" ? "tsconfig.next16.json" : "tsconfig.json";
  // What next-env.d.ts gives a real app: Next's global types.
  writeFileSync(`${dir}guide-env.d.ts`, '/// <reference types="next" />\n');
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
