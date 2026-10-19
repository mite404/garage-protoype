alter table signal_desk.growth_schedules enable row level security;
revoke all on signal_desk.growth_schedules from public;
grant select,insert,update on signal_desk.growth_schedules to signal_desk_runtime;
create policy server_access on signal_desk.growth_schedules to signal_desk_runtime
  using (true) with check (true);
create index growth_schedules_due on signal_desk.growth_schedules(next_at,id);
create index growth_schedules_actor on signal_desk.growth_schedules(actor_id);
