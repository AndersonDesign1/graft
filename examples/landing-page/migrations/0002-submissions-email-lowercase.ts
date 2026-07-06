/**
 * Normalize stored submission emails to lowercase — the canonical data
 * migration: a backfill over rows Postgres owns, run in one transaction and
 * recorded in the migrations_applied ledger.
 *
 * Dry-run with `graft migrate`; execute with `graft migrate --apply`.
 */
import { defineDataMigration } from "@graft/core";
import { submissions } from "../graft.config";

export default defineDataMigration({
  collection: submissions,
  description: "Lowercase every stored submission email",
  transform: ({ data }) => ({
    ...(data as { email: string; message?: string }),
    email: (data.email as string).toLowerCase(),
  }),
});
