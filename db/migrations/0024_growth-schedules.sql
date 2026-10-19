CREATE TABLE "signal_desk"."growth_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"credential" jsonb NOT NULL,
	"configuration" jsonb NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"fence" integer DEFAULT 0 NOT NULL,
	"last_code" text,
	"duration_ms" integer,
	"watermark" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."growth_schedules" ADD CONSTRAINT "growth_schedules_actor_id_identities_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "signal_desk"."identities"("user_id") ON DELETE no action ON UPDATE no action;