CREATE TABLE "signal_desk"."inquiry_suggestions" (
	"inquiry_id" text PRIMARY KEY NOT NULL,
	"suggestion" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_attempts" ADD COLUMN "rate_tokens" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_desk"."inference_models" ADD COLUMN "rate_tokens" integer DEFAULT 1 NOT NULL;