/** Bin entry — everything testable lives in cli.ts. */
import { enableCompileCache } from "node:module";

// Keeps V8's compiled code for the CLI on disk between runs (Node 22.1+; a
// no-op where the cache cannot be written). NODE_DISABLE_COMPILE_CACHE=1
// turns it off.
enableCompileCache?.();
const { run } = await import("./cli");
process.exit(await run(process.argv.slice(2)));
