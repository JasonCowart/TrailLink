-- TrailLink: "Need help" alerts. A help message stays on every rider's map until its author sends "I'm OK"
-- (a helpclear message answering it). Safe to run more than once.
alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check check (kind in ('text', 'quick', 'location', 'help', 'helpclear', 'spotclear')); -- spotclear from 017 (kept here so re-running setup works)
