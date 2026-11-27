-- TrailLink: "Seen by" for group messages. Each rider's phone records when they last looked at the group chat;
-- a message counts as seen by everyone whose time is after it. Safe to run more than once.
create table if not exists public.group_reads (
  group_id uuid not null,
  rider_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (group_id, rider_id)
);
alter table public.group_reads enable row level security;
drop policy if exists "members see reads" on public.group_reads;
create policy "members see reads" on public.group_reads for select to authenticated using (public.was_group_member(group_id));
drop policy if exists "own read mark" on public.group_reads;
create policy "own read mark" on public.group_reads for insert to authenticated with check (rider_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists "move own read mark" on public.group_reads;
create policy "move own read mark" on public.group_reads for update to authenticated using (rider_id = auth.uid()) with check (rider_id = auth.uid() and public.is_group_member(group_id));
revoke all on public.group_reads from anon, authenticated;
grant select, insert, update on public.group_reads to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant select, insert, update, delete on public.group_reads to service_role'; end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_reads') then
    execute 'alter publication supabase_realtime add table public.group_reads';
  end if;
end $$;
