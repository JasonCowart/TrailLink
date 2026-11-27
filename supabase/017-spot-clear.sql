-- TrailLink: the rider who messaged a spot can take it off everyone's map (a "spotclear" message answering it).
alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check check (kind in ('text', 'quick', 'location', 'help', 'helpclear', 'spotclear'));
