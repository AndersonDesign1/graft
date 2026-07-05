CREATE TABLE "data_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"collection" text NOT NULL,
	"data" jsonb NOT NULL,
	"actor_kind" text DEFAULT 'anonymous' NOT NULL,
	"actor_id" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "data_records_lookup" ON "data_records" USING btree ("branch_id","collection","created_at");