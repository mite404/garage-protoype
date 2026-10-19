alter table signal_desk.growth_invitations enable row level security;
alter table signal_desk.growth_feedback enable row level security;
revoke all on signal_desk.growth_invitations,signal_desk.growth_feedback from public;
grant select,insert on signal_desk.growth_invitations,signal_desk.growth_feedback
  to signal_desk_runtime;
create policy server_read on signal_desk.growth_invitations for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_invitations for insert
  to signal_desk_runtime with check (true);
create policy server_read on signal_desk.growth_feedback for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.growth_feedback for insert
  to signal_desk_runtime with check (true);
create index growth_feedback_invitation on signal_desk.growth_feedback(invitation_id,submitted_at,id);
