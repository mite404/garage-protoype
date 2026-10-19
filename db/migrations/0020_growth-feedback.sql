CREATE TABLE "signal_desk"."growth_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"invitation_id" text,
	"reference" text NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"original" jsonb NOT NULL,
	"answer" jsonb,
	"submitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."growth_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"call_key" text NOT NULL,
	"recipient" text NOT NULL,
	"version" text NOT NULL,
	"stage" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_feedback" ADD CONSTRAINT "growth_feedback_invitation_id_growth_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "signal_desk"."growth_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_invitations" ADD CONSTRAINT "growth_invitations_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_feedback_source" ON "signal_desk"."growth_feedback" USING btree ("channel","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_invitation_call" ON "signal_desk"."growth_invitations" USING btree ("account_id","call_key","version");