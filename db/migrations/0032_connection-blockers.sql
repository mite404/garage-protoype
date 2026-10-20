CREATE TABLE "signal_desk"."connection_blockers" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"kind" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "signal_desk"."connection_blockers" ADD CONSTRAINT "connection_blockers_case_id_sourcing_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "signal_desk"."sourcing_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_blockers_open" ON "signal_desk"."connection_blockers" USING btree ("case_id","kind") WHERE resolved_at is null;