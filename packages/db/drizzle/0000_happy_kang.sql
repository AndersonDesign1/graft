CREATE TABLE "content_index" (
	"branch_id" text DEFAULT 'main' NOT NULL,
	"collection" text NOT NULL,
	"slug" text NOT NULL,
	"data" jsonb NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_path" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_index_branch_id_collection_slug_pk" PRIMARY KEY("branch_id","collection","slug")
);
--> statement-breakpoint
CREATE INDEX "content_index_lookup" ON "content_index" USING btree ("collection","slug","branch_id");