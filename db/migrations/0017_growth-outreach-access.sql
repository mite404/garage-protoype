alter table signal_desk.growth_messages enable row level security;
alter table signal_desk.growth_suppressions enable row level security;
alter table signal_desk.growth_receipts enable row level security;
revoke all on signal_desk.growth_messages,signal_desk.growth_suppressions,
  signal_desk.growth_receipts from public;
grant select,insert,update on signal_desk.growth_messages to signal_desk_runtime;
grant select,insert on signal_desk.growth_suppressions,signal_desk.growth_receipts
  to signal_desk_runtime;
create policy server_access on signal_desk.growth_messages to signal_desk_runtime
  using (true) with check (true);
create policy server_read on signal_desk.growth_suppressions for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_suppressions for insert
  to signal_desk_runtime with check (true);
create policy server_read on signal_desk.growth_receipts for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_receipts for insert
  to signal_desk_runtime with check (true);
create index growth_messages_due on signal_desk.growth_messages(state,due_at,id);
create index growth_messages_actor on signal_desk.growth_messages(actor_id);
create index growth_receipts_message on signal_desk.growth_receipts(message_id);
