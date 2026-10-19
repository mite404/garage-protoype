CREATE TABLE "signal_desk"."growth_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"enrollment_key" text NOT NULL,
	"step" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"credential" jsonb NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"due_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "growth_messages_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."growth_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"kind" text NOT NULL,
	"original" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_desk"."growth_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_messages" ADD CONSTRAINT "growth_messages_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_messages" ADD CONSTRAINT "growth_messages_actor_id_identities_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_receipts" ADD CONSTRAINT "growth_receipts_message_id_growth_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "signal_desk"."growth_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_message_step" ON "signal_desk"."growth_messages" USING btree ("account_id","enrollment_key","step");