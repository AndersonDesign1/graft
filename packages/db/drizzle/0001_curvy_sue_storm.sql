CREATE TABLE "compilations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" text NOT NULL,
	"git_sha" text,
	"doc_count" integer NOT NULL,
	"added" integer NOT NULL,
	"changed" integer NOT NULL,
	"removed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "compilations_branch_created" ON "compilations" USING btree ("branch_id","created_at");