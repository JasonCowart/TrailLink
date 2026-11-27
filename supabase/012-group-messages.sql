-- TrailLink: group messages, kept as a ride log, and phone notifications. Safe to run more than once.
-- Owner's choices (2026-11-27): group-only (no direct messages yet), notifications on, messages kept after the group ends.

-- Everyone who was ever in a group, so the ride log stays readable after they leave or the group ends.
create table if not exists public.group_log_members (
  group_id   uuid not null,
  rider_id   uuid not null references public.profiles (id) on delete cascade,
  group_name text not null,
  joined_at  timestamptz not null default now(),
  primary key (group_id, rider_id)
);
create or replace function public.log_group_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.group_log_members (group_id, rider_id, group_name)
    select new.group_id, new.rider_id, g.name from public.groups g where g.id = new.group_id
    on conflict (group_id, rider_id) do nothing;
  return new;
end $$;
drop trigger if exists log_member on public.group_members;
create trigger log_member after insert on public.group_members for each row execute function public.log_group_member();
-- Riders already in groups before this change.
insert into public.group_log_members (group_id, rider_id, group_name)
  select m.group_id, m.rider_id, g.name from public.group_members m join public.groups g on g.id = m.group_id
  on conflict do nothing;

create or replace function public.was_group_member(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_log_members where group_id = g and rider_id = auth.uid())
$$;

-- Messages. The id comes from the phone, so a message queued offline is never sent twice.
create table if not exists public.group_messages (
  id         uuid primary key,
  group_id   uuid not null,
  rider_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text', 'quick', 'location')),
  body       text not null default '' check (char_length(body) <= 500),
  lat        double precision check (lat between -90 and 90),
  lon        double precision check (lon between -180 and 180),
  sent_at    timestamptz not null default now(),   -- when the rider pressed Send (may be earlier than created_at if offline)
  created_at timestamptz not null default now()    -- when it reached the database
);
create index if not exists group_messages_group on public.group_messages (group_id, created_at);

alter table public.group_log_members enable row level security;
alter table public.group_messages enable row level security;
drop policy if exists "own ride log" on public.group_log_members;
create policy "own ride log" on public.group_log_members for select to authenticated using (rider_id = auth.uid());
drop policy if exists "ride log readers" on public.group_messages;
create policy "ride log readers" on public.group_messages for select to authenticated using (public.was_group_member(group_id));
drop policy if exists "members send" on public.group_messages;
create policy "members send" on public.group_messages for insert to authenticated
  with check (rider_id = auth.uid() and public.is_group_member(group_id));
revoke all on public.group_log_members, public.group_messages from anon, authenticated;
grant select on public.group_log_members to authenticated;
grant select, insert on public.group_messages to authenticated;
revoke execute on function public.was_group_member(uuid) from public, anon;
grant execute on function public.was_group_member(uuid) to authenticated;

-- Phones that asked for notifications (Web Push). Each rider manages only their own.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  rider_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own phones" on public.push_subscriptions;
create policy "own phones" on public.push_subscriptions for all to authenticated using (rider_id = auth.uid()) with check (rider_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Live delivery to open apps (Supabase Realtime), when available.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_messages') then
    execute 'alter publication supabase_realtime add table public.group_messages';
  end if;
end $$;

-- New message → ask the "push" function to notify the group's other phones. Needs pg_net (Supabase) and the
-- function's address and shared secret in private.push_config (set by scripts/supabase-admin.mjs push-setup).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.push_config (id int primary key default 1 check (id = 1), url text not null, secret text not null);
create or replace function public.notify_group_message() returns trigger language plpgsql security definer set search_path = public, private as $$
declare cfg private.push_config;
begin
  select * into cfg from private.push_config where id = 1;
  if cfg.url is null or to_regnamespace('net') is null then return new; end if;
  perform net.http_post(url := cfg.url, body := jsonb_build_object('message_id', new.id),
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', cfg.secret));
  return new;
exception when others then
  return new; -- never block a message because a notification failed
end $$;
drop trigger if exists push_on_message on public.group_messages;
create trigger push_on_message after insert on public.group_messages for each row execute function public.notify_group_message();
