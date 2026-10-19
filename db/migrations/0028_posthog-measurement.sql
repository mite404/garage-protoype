CREATE TABLE "signal_desk"."growth_telemetry" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"synthetic" boolean NOT NULL,
	"kind" text NOT NULL,
	"variant" text,
	"message_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."outreach_experiments" (
	"account_id" text PRIMARY KEY NOT NULL,
	"scope_id" uuid NOT NULL,
	"synthetic" boolean NOT NULL,
	"variant" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enrollment_key" text,
	"exposed_at" timestamp with time zone,
	"qualified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_telemetry" ADD CONSTRAINT "growth_telemetry_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_telemetry" ADD CONSTRAINT "growth_telemetry_scope_id_identities_user_id_fk" FOREIGN KEY ("scope_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."outreach_experiments" ADD CONSTRAINT "outreach_experiments_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."outreach_experiments" ADD CONSTRAINT "outreach_experiments_scope_id_identities_user_id_fk" FOREIGN KEY ("scope_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;