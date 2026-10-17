-- Hosted Supabase operators cannot grant USAGE on the managed auth schema.
-- Expose only the current-session predicate, never Auth rows or broader role membership.
create function signal_desk.session_is_active(session_id uuid, actor_id uuid) returns boolean
language sql security definer set search_path = pg_catalog as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = session_id and s.user_id = actor_id
      and (s.not_after is null or s.not_after > clock_timestamp())
  );
$$;
revoke all on function signal_desk.session_is_active(uuid,uuid) from public;
grant execute on function signal_desk.session_is_active(uuid,uuid) to signal_desk_runtime;
revoke select (id,user_id,not_after) on auth.sessions from signal_desk_runtime;
drop policy signal_desk_session_read on auth.sessions;
