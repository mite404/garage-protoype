alter table signal_desk.inference_operations add constraint inference_one_context
  check ((opportunity_id is null) <> (prospect_id is null));
create index inference_operations_prospect on signal_desk.inference_operations(prospect_id);
alter table signal_desk.growth_insights enable row level security;
revoke all on signal_desk.growth_insights from public;
grant select,insert on signal_desk.growth_insights to signal_desk_runtime;
create policy server_read on signal_desk.growth_insights for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_insights for insert
  to signal_desk_runtime with check (true);
