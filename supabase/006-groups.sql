-- TrailLink: ride groups. Any rider can start a group and share its join code; riders join and leave freely.
-- A rider's position is visible to the group only while they have "Share my location" on. Safe to run more than once.

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  code       text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  rider_id  uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  sharing   boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, rider_id)
);
create index if not exists group_members_rider on public.group_members (rider_id);

-- Latest position per rider per group. Leaving the group deletes it.
create table if not exists public.group_positions (
  group_id uuid not null,
  rider_id uuid not null default auth.uid(),
  lat      double precision not null check (lat between -90 and 90),
  lon      double precision not null check (lon between -180 and 180),
  acc      real, speed real, heading real,
  at       timestamptz not null default now(),
  primary key (group_id, rider_id),
  foreign key (group_id, rider_id) references public.group_members (group_id, rider_id) on delete cascade
);

create or replace function public.is_group_member(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and rider_id = auth.uid())
$$;
create or replace function public.is_sharing(g uuid, r uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select sharing from public.group_members where group_id = g and rider_id = r), false)
$$;

-- Turning sharing off removes your position from the group right away.
create or replace function public.clear_position_when_not_sharing() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.sharing then delete from public.group_positions where group_id = new.group_id and rider_id = new.rider_id; end if;
  return new;
end $$;
drop trigger if exists sharing_off on public.group_members;
create trigger sharing_off after update of sharing on public.group_members for each row execute function public.clear_position_when_not_sharing();

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_positions enable row level security;

drop policy if exists "members see their groups" on public.groups;
create policy "members see their groups" on public.groups for select to authenticated using (public.is_group_member(id));

drop policy if exists "members see each other" on public.group_members;
create policy "members see each other" on public.group_members for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "own sharing switch" on public.group_members;
create policy "own sharing switch" on public.group_members for update to authenticated using (rider_id = auth.uid()) with check (rider_id = auth.uid());
drop policy if exists "leave a group" on public.group_members;
create policy "leave a group" on public.group_members for delete to authenticated using (rider_id = auth.uid());

drop policy if exists "members see sharing riders" on public.group_positions;
create policy "members see sharing riders" on public.group_positions for select to authenticated
  using (public.is_group_member(group_id) and public.is_sharing(group_id, rider_id));
drop policy if exists "post own position" on public.group_positions;
create policy "post own position" on public.group_positions for insert to authenticated
  with check (rider_id = auth.uid() and public.is_sharing(group_id, rider_id));
drop policy if exists "update own position" on public.group_positions;
create policy "update own position" on public.group_positions for update to authenticated
  using (rider_id = auth.uid()) with check (rider_id = auth.uid() and public.is_sharing(group_id, rider_id));
drop policy if exists "delete own position" on public.group_positions;
create policy "delete own position" on public.group_positions for delete to authenticated using (rider_id = auth.uid());

revoke all on public.groups, public.group_members, public.group_positions from anon, authenticated;
grant select on public.groups to authenticated;
grant select, delete on public.group_members to authenticated;
grant update (sharing) on public.group_members to authenticated;
grant select, insert, update, delete on public.group_positions to authenticated;

-- Starting, joining and leaving go through these functions (a rider can't see a group before joining it).
create or replace function public.create_group(p_name text) returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups; c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  loop
    c := (select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.groups where code = c);
  end loop;
  insert into public.groups (name, code, created_by) values (left(trim(p_name), 40), c, auth.uid()) returning * into g;
  insert into public.group_members (group_id, rider_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function public.join_group(p_code text) returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into g from public.groups where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if g.id is null then raise exception 'No group has that code. Check it with whoever shared it.' using errcode = '22023'; end if;
  insert into public.group_members (group_id, rider_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end $$;

create or replace function public.leave_group(p_group uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_members where group_id = p_group and rider_id = auth.uid();
  delete from public.groups g where g.id = p_group and not exists (select 1 from public.group_members m where m.group_id = p_group);
end $$;

revoke execute on function public.create_group(text), public.join_group(text), public.leave_group(uuid),
  public.is_group_member(uuid), public.is_sharing(uuid, uuid) from public, anon;
grant execute on function public.create_group(text), public.join_group(text), public.leave_group(uuid),
  public.is_group_member(uuid), public.is_sharing(uuid, uuid) to authenticated;
