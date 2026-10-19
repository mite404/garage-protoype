alter table signal_desk.growth_accounts enable row level security;
alter table signal_desk.growth_observations enable row level security;
alter table signal_desk.growth_events enable row level security;
alter table signal_desk.growth_territories enable row level security;
revoke all on signal_desk.growth_accounts, signal_desk.growth_observations,
  signal_desk.growth_events, signal_desk.growth_territories from public;
grant select, insert, update on signal_desk.growth_accounts to signal_desk_runtime;
grant select, insert on signal_desk.growth_observations, signal_desk.growth_events
  to signal_desk_runtime;
grant select on signal_desk.growth_territories to signal_desk_runtime;
create policy server_access on signal_desk.growth_accounts to signal_desk_runtime
  using (true) with check (true);
create policy server_read on signal_desk.growth_observations for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_observations for insert
  to signal_desk_runtime with check (true);
create policy server_read on signal_desk.growth_events for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_events for insert
  to signal_desk_runtime with check (true);
create policy server_read on signal_desk.growth_territories for select
  to signal_desk_runtime using (true);
create index growth_accounts_owner on signal_desk.growth_accounts(owner_id,id);
create index growth_events_account on signal_desk.growth_events(account_id,created_at);
create index growth_territories_specialist on signal_desk.growth_territories(specialist_id);
