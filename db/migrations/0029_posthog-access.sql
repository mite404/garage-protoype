alter table signal_desk.growth_telemetry enable row level security;
alter table signal_desk.outreach_experiments enable row level security;
revoke all on signal_desk.growth_telemetry, signal_desk.outreach_experiments from public;
grant select,insert,update on signal_desk.growth_telemetry, signal_desk.outreach_experiments
  to signal_desk_runtime;
create policy server_access on signal_desk.growth_telemetry to signal_desk_runtime
  using (true) with check (true);
create policy server_access on signal_desk.outreach_experiments to signal_desk_runtime
  using (true) with check (true);
alter table signal_desk.outreach_experiments add constraint outreach_variant_check
  check (variant in ('control','evidence_first'));
alter table signal_desk.growth_telemetry add constraint telemetry_kind_check
  check (kind in ('eligible','assigned','exposed','qualified','qualified_reply',
    'outreach_accepted','outreach_delivered','opportunity_created','progressed','closed_lost'));
alter table signal_desk.growth_telemetry add constraint telemetry_variant_check
  check (variant is null or variant in ('control','evidence_first'));
create index growth_telemetry_pending on signal_desk.growth_telemetry
  (attempted_at,occurred_at,id) where delivered_at is null;
create index growth_telemetry_message on signal_desk.growth_telemetry(message_id);
create index growth_telemetry_scope on signal_desk.growth_telemetry(scope_id,account_id);
create index outreach_experiments_scope on signal_desk.outreach_experiments(scope_id);
