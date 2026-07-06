CREATE TABLE "migrations_applied" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"migration_id" text NOT NULL,
	"kind" text NOT NULL,
	"collection" text NOT NULL,
	"doc_count" integer NOT NULL,
	"git_sha" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "migrations_applied_branch_migration" ON "migrations_applied" USING btree ("branch_id","migration_id");