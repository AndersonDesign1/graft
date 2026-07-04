/** Bin entry — everything testable lives in cli.ts. */
import { run } from "./cli";

process.exit(await run(process.argv.slice(2)));
