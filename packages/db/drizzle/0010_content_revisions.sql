-- Authored content for database-sourced projects: immutable revisions, one
-- head per path (the live revision and the draft), and review requests from
-- people who may not publish. Git-sourced projects never write these tables.
CREATE TABLE "content_heads" (
	"branch_id" text DEFAULT 'main' NOT NULL,
	"path" text NOT NULL,
	"published_id" uuid,
	"draft_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_heads_branch_id_path_pk" PRIMARY KEY("branch_id","path")
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"paths" jsonb NOT NULL,
	"title" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"requested_by_name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"path" text NOT NULL,
	"raw" text,
	"version" text,
	"parent_id" uuid,
	"actor_kind" text DEFAULT 'human' NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text,
	"actor_email" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_id" text,
	"published_by_name" text
);
--> statement-breakpoint
ALTER TABLE "content_heads" ADD CONSTRAINT "content_heads_published_fk" FOREIGN KEY ("published_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_heads" ADD CONSTRAINT "content_heads_draft_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."content_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_reviews_open" ON "content_reviews" USING btree ("branch_id","status","created_at");--> statement-breakpoint
CREATE INDEX "content_revisions_path" ON "content_revisions" USING btree ("branch_id","path","created_at");--> statement-breakpoint
ALTER TABLE "content_reviews"
  ADD CONSTRAINT "content_reviews_status_known"
  CHECK ("status" IN ('open', 'published', 'closed'));
--> statement-breakpoint

-- A published revision is the record of what went live, and history and
-- restore read it. Nothing legitimate changes one: a later edit is a new
-- revision. The runtime role holds UPDATE on this table for drafts (an
-- autosave updates its draft in place, and publishing stamps it once), so
-- this refuses the rest below the application, where no grant change can
-- reopen it.
CREATE OR REPLACE FUNCTION graft_revision_published_is_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'a published revision is final; write a new revision instead';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "content_revisions_published_is_final"
  BEFORE UPDATE ON "content_revisions"
  FOR EACH ROW EXECUTE FUNCTION graft_revision_published_is_final();
