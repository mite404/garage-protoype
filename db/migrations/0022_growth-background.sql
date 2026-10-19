CREATE TABLE "signal_desk"."growth_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_operations" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_operations" ADD COLUMN "prospect_id" text;--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_insights" ADD CONSTRAINT "growth_insights_account_id_growth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_insight_input" ON "signal_desk"."growth_insights" USING btree ("account_id","input_hash");--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_operations" ADD CONSTRAINT "inference_operations_prospect_id_growth_accounts_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "signal_desk"."growth_accounts"("id") ON DELETE no action ON UPDATE no action;