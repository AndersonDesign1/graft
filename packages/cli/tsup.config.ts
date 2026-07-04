import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  dts: false,
  // Commands are `await import()`ed so `--help`/`--version`/usage errors never
  // pay for the database driver; splitting keeps those imports lazy in dist.
  splitting: true,
  banner: { js: "#!/usr/bin/env node" },
});
