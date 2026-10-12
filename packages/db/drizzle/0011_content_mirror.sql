-- What a database-sourced project has copied to git, so a mirror run commits
-- only what changed since the last one.
CREATE TABLE "content_mirror" (
	"branch_id" text DEFAULT 'main' NOT NULL,
	"path" text NOT NULL,
	"version" text,
	"commit_sha" text,
	"mirrored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_mirror_branch_id_path_pk" PRIMARY KEY("branch_id","path")
);
