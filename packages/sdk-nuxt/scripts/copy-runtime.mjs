// Ship the runtime next to dist/module.js as compiled JavaScript, which Nitro
// and Vite load (Nitro 2 does not compile TypeScript from node_modules).
//
// Types: each runtime/x.js gets an x.d.ts that re-exports from types/x.ts, the
// untouched source. The app's own typecheck reads that source against the
// app's real Nuxt, so `useGraftContent`'s return type is Nuxt's own AsyncData.
// The sources live outside runtime/ because Nitro resolves an extensionless
// import to a .ts file before a .js one.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const from = fileURLToPath(new URL("../src/runtime", import.meta.url));
const runtime = fileURLToPath(new URL("../dist/runtime", import.meta.url));
const types = fileURLToPath(new URL("../dist/types", import.meta.url));
rmSync(runtime, { recursive: true, force: true });
rmSync(types, { recursive: true, force: true });

for (const entry of readdirSync(from, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
  const source = join(entry.parentPath, entry.name);
  const path = relative(from, source);
  const code = readFileSync(source, "utf8");

  const typeCopy = join(types, path);
  mkdirSync(dirname(typeCopy), { recursive: true });
  writeFileSync(typeCopy, code);

  const js = join(runtime, path.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(js), { recursive: true });
  writeFileSync(js, transformSync(code, { loader: "ts", format: "esm", target: "es2022" }).code);

  const specifier = relative(dirname(js), typeCopy.replace(/\.ts$/, "")).replaceAll("\\", "/");
  const reexport = [`export * from "${specifier}";`];
  if (/^export default /m.test(code)) reexport.push(`export { default } from "${specifier}";`);
  writeFileSync(js.replace(/\.js$/, ".d.ts"), `${reexport.join("\n")}\n`);
}
