alter table signal_desk.import_jobs add constraint import_jobs_dropped_claims_check
  check (dropped_claims >= 0);
--> statement-breakpoint
grant update(dropped_claims) on signal_desk.import_jobs to signal_desk_runtime;
