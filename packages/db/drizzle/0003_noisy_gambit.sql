CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"function_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"input_canonical" text NOT NULL,
	"requested_by_kind" text NOT NULL,
	"requested_by_id" text,
	"correlation_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" text NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"function_name" text NOT NULL,
	"function_kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"rate_key" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"git_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approvals_status_created" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_rate" ON "audit_log" USING btree ("rate_key","function_name","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_branch_created" ON "audit_log" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_correlation" ON "audit_log" USING btree ("correlation_id");