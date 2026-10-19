CREATE TABLE "signal_desk"."buyer_needs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"buyer_organization_id" text,
	"buyer_label" text NOT NULL,
	"statement" text NOT NULL,
	"provenance" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"constraints" jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"inventory" jsonb,
	"review_at" timestamp with time zone,
	"synthetic" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."pairing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."pairing_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"basis" text NOT NULL,
	"source_ref" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."source_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"source_label" text NOT NULL,
	"url" text NOT NULL,
	"excerpt" text NOT NULL,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"disposition" text DEFAULT 'open' NOT NULL,
	"synthetic" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."sourcing_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"need_id" text NOT NULL,
	"seller_prospect_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"stage" text DEFAULT 'investigate' NOT NULL,
	"next_action" text NOT NULL,
	"decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."assistance_drafts" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."chat_turns" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."inquiries" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."stream_turns" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."stream_turns" ALTER COLUMN "inquiry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."assistance_drafts" ADD COLUMN "sourcing_case_id" text;--> statement-breakpoint
ALTER TABLE "signal_desk"."chat_turns" ADD COLUMN "sourcing_case_id" text;--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_operations" ADD COLUMN "sourcing_case_id" text;--> statement-breakpoint
ALTER TABLE "signal_desk"."inquiries" ADD COLUMN "sourcing_case_id" text;--> statement-breakpoint
ALTER TABLE "signal_desk"."stream_turns" ADD COLUMN "sourcing_case_id" text;--> statement-breakpoint
ALTER TABLE "signal_desk"."buyer_needs" ADD CONSTRAINT "buyer_needs_owner_id_identities_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."buyer_needs" ADD CONSTRAINT "buyer_needs_buyer_organization_id_organizations_id_fk" FOREIGN KEY ("buyer_organization_id") REFERENCES "signal_desk"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."pairing_events" ADD CONSTRAINT "pairing_events_case_id_sourcing_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."pairing_events" ADD CONSTRAINT "pairing_events_actor_id_identities_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."pairing_facts" ADD CONSTRAINT "pairing_facts_case_id_sourcing_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."pairing_facts" ADD CONSTRAINT "pairing_facts_reviewed_by_identities_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."source_changes" ADD CONSTRAINT "source_changes_case_id_sourcing_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."sourcing_cases" ADD CONSTRAINT "sourcing_cases_need_id_buyer_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "signal_desk"."buyer_needs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."sourcing_cases" ADD CONSTRAINT "sourcing_cases_seller_prospect_id_growth_accounts_id_fk" FOREIGN KEY ("seller_prospect_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."sourcing_cases" ADD CONSTRAINT "sourcing_cases_owner_id_identities_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_change_case_key" ON "signal_desk"."source_changes" USING btree ("case_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_case_pairing" ON "signal_desk"."sourcing_cases" USING btree ("need_id","seller_prospect_id");--> statement-breakpoint
ALTER TABLE "signal_desk"."assistance_drafts" ADD CONSTRAINT "assistance_drafts_sourcing_case_id_sourcing_cases_id_fk" FOREIGN KEY ("sourcing_case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."chat_turns" ADD CONSTRAINT "chat_turns_sourcing_case_id_sourcing_cases_id_fk" FOREIGN KEY ("sourcing_case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_operations" ADD CONSTRAINT "inference_operations_sourcing_case_id_sourcing_cases_id_fk" FOREIGN KEY ("sourcing_case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."inquiries" ADD CONSTRAINT "inquiries_sourcing_case_id_sourcing_cases_id_fk" FOREIGN KEY ("sourcing_case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."stream_turns" ADD CONSTRAINT "stream_turns_sourcing_case_id_sourcing_cases_id_fk" FOREIGN KEY ("sourcing_case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;