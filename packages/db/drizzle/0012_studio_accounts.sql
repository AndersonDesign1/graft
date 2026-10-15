-- Studio accounts: people who sign in with an email and password, their
-- sessions (stored as token hashes, so they can be revoked), and invitations.
CREATE TABLE "studio_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "studio_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "studio_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"owner" boolean DEFAULT false NOT NULL,
	"failed_sign_ins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_invites" ADD CONSTRAINT "studio_invites_invited_by_id_studio_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."studio_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_sessions" ADD CONSTRAINT "studio_sessions_user_id_studio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."studio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_invites_email" ON "studio_invites" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "studio_sessions_user" ON "studio_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_users_email" ON "studio_users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "studio_users" ADD CONSTRAINT "studio_users_role_check" CHECK ("role" IN ('viewer', 'contributor', 'editor', 'admin'));--> statement-breakpoint
ALTER TABLE "studio_invites" ADD CONSTRAINT "studio_invites_role_check" CHECK ("role" IN ('viewer', 'contributor', 'editor', 'admin'));
