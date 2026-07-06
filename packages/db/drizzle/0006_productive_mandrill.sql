CREATE TABLE "branches" (
	"name" text PRIMARY KEY NOT NULL,
	"parent" text,
	"backend" text DEFAULT 'overlay' NOT NULL,
	"endpoint_host" text,
	"neon_branch_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_fk" FOREIGN KEY ("parent") REFERENCES "public"."branches"("name") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "branches" ("name", "parent", "backend") VALUES ('main', NULL, 'overlay') ON CONFLICT DO NOTHING;