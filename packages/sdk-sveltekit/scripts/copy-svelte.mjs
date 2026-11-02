// Ship the Svelte components as source, as Svelte libraries do: the app's own
// Svelte compiles them, so they match its version. tsup builds the rest.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/mdx", { recursive: true });
cpSync("src/mdx", "dist/mdx", { recursive: true });
