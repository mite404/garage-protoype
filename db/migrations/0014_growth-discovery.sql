CREATE TABLE "signal_desk"."growth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"organization_id" text,
	"opportunity_id" text,
	"directory" jsonb NOT NULL,
	"review" jsonb,
	"routing" text DEFAULT 'Unassigned; review territory' NOT NULL,
	"identity_state" text DEFAULT 'needs_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_accounts_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."growth_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."growth_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"fingerprint" text NOT NULL,
	"original" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."growth_territories" (
	"id" text PRIMARY KEY NOT NULL,
	"postal_prefix" text NOT NULL,
	"specialist_id" uuid NOT NULL,
	CONSTRAINT "growth_territories_postal_prefix_unique" UNIQUE("postal_prefix")
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_accounts" ADD CONSTRAINT "growth_accounts_owner_id_identities_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_accounts" ADD CONSTRAINT "growth_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "signal_desk"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_accounts" ADD CONSTRAINT "growth_accounts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "signal_desk"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_events" ADD CONSTRAINT "growth_events_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_observations" ADD CONSTRAINT "growth_observations_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_territories" ADD CONSTRAINT "growth_territories_specialist_id_identities_user_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_observation_identity" ON "signal_desk"."growth_observations" USING btree ("account_id","snapshot","fingerprint");