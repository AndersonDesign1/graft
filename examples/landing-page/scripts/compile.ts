/**
 * Project content/ into the content_index. Run after editing any MDX:
 *   pnpm compile
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@graft/compiler";
import { createDb } from "@graft/db";
import { collections } from "../graft.config";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* rely on the ambient environment */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — add it to the repo-root .env.");
  process.exit(1);
}

const handle = createDb(url);
try {
  const result = await compile({
    db: handle.db,
    contentDir: resolve(here, "../content"),
    collections,
  });
  const { added, changed, removed, unchanged } = result.changes;
  console.log(
    `Compiled ${result.count} doc(s) @ ${result.gitSha?.slice(0, 7) ?? "no-git"}: ` +
      `+${added.length} added, ~${changed.length} changed, -${removed.length} removed, ${unchanged} unchanged`,
  );
  for (const key of [...added, ...changed]) console.log(`  upserted ${key}`);
  for (const key of removed) console.log(`  removed  ${key}`);
} finally {
  await handle.close();
}
