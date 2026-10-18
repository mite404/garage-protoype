-- Truthful progress for a running turn, written by the owner from real preparation and tool
-- steps. It is presentation state only: it grants nothing and is never model input.
alter table signal_desk.stream_turns
  add column activity text
  check (activity in ('reading_deal','checking_evidence','preparing_draft','writing'));
