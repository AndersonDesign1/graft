-- Media, agents and site settings, edited in Studio: a catalogue of the files
-- in the asset store (type, size, alt text), tokens an admin made for agents
-- (hashes only), the site's name and URL, and URLs called after each publish.
CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"key" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"alt" text,
	"uploaded_by_id" text,
	"uploaded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deploy_hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY DEFAULT 'site' NOT NULL,
	"name" text,
	"url" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_created_by_id_studio_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."studio_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tokens_created" ON "agent_tokens" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assets_created" ON "assets" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_one_row" CHECK ("id" = 'site');--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_bytes_check" CHECK ("bytes" >= 0);--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_scopes_array" CHECK (jsonb_typeof("scopes") = 'array');
