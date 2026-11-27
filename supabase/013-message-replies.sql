-- TrailLink: reply to a specific message in the group chat (like iPhone Messages). Safe to run more than once.
alter table public.group_messages add column if not exists reply_to uuid;
