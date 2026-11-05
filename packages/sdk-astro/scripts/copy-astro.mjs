// Ship the Astro components as source, as Astro libraries do: the app's own
// Astro compiles them, so they match its version. tsup builds the rest.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/mdx", { recursive: true });
cpSync("src/mdx", "dist/mdx", {
  recursive: true,
  filter: (source) => !/\.test\.[jt]s$/.test(source),
});
