create table signal_desk.inquiries (
  id text primary key,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  request_key text not null,
  input jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id,request_key)
);
create index inquiries_opportunity on signal_desk.inquiries(opportunity_id,created_at);
create table signal_desk.inquiry_routing (
  id text primary key,
  inquiry_id text not null references signal_desk.inquiries(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  kind text not null check(kind in ('supported','missing_evidence','conflict','human_review','conditional_offer')),
  field text,
  basis text not null,
  revision integer not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(inquiry_id,revision)
);
create index inquiry_routing_actor on signal_desk.inquiry_routing(actor_id);
create table signal_desk.assistance_drafts (
  id text primary key,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  request_key text not null,
  input jsonb not null,
  purpose text not null check(purpose in ('seller_request','buyer_followup','photo_request')),
  recipient_label text not null,
  body text not null,
  basis_revision integer not null,
  evidence_basis jsonb not null,
  blocker_id text references signal_desk.evidence_blockers(id),
  review_id text references signal_desk.evidence_reviews(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id,request_key)
);
create index assistance_drafts_opportunity on signal_desk.assistance_drafts(opportunity_id);
create index assistance_drafts_blocker on signal_desk.assistance_drafts(blocker_id);
create index assistance_drafts_review on signal_desk.assistance_drafts(review_id);
create table signal_desk.chat_turns (
  id text primary key,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  request_key text not null,
  message text not null,
  inquiry_id text references signal_desk.inquiries(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id,request_key)
);
create index chat_turns_opportunity on signal_desk.chat_turns(opportunity_id,created_at);
create index chat_turns_inquiry on signal_desk.chat_turns(inquiry_id);
create table signal_desk.card_calls (
  turn_id text not null references signal_desk.chat_turns(id) on delete cascade,
  call_id text not null,
  tool text not null,
  input jsonb not null,
  status text not null check(status in ('accepted','malformed','retired','unavailable')),
  primary key(turn_id,call_id)
);
create index card_calls_retirement on signal_desk.card_calls(turn_id,tool,status);
do $$ declare t text; begin
  foreach t in array array['inquiries','inquiry_routing','assistance_drafts','chat_turns','card_calls'] loop
    execute format('alter table signal_desk.%I enable row level security',t);
    execute format('grant select,insert on signal_desk.%I to signal_desk_runtime',t);
    execute format('create policy server_read on signal_desk.%I for select to signal_desk_runtime using (true)',t);
    execute format('create policy server_insert on signal_desk.%I for insert to signal_desk_runtime with check (true)',t);
  end loop;
end $$;
