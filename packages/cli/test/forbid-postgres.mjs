// Loaded with `node --import` by static-startup.test.ts. Every time the
// Postgres code (drizzle-orm or the postgres driver) is resolved, it writes a
// marker line to stderr naming the module that asked, so the test can fail
// with the importer in hand. It logs instead of throwing so a load inside a
// try/catch is still seen.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^(drizzle-orm|postgres)(\/|$)/.test(specifier)) {
      process.stderr.write(`[forbidden-import] ${specifier} from ${context.parentURL}\n`);
    }
    return nextResolve(specifier, context);
  },
});
