-- TrailLink: shared pins. Hazard reports are shared with all riders (everyone in TrailLink is invited) and stay until
-- someone marks them cleared. Other pins are private unless the rider shares them with their ride group.
-- Safe to run more than once.

create table if not exists public.shared_pins (
  id                uuid primary key,                      -- made on the phone, so pins can be created offline
  rider_id          uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  audience          text not null check (audience in ('all', 'group')),
  group_id          uuid references public.groups (id) on delete cascade,
  kind              text not null check (kind in ('regroup', 'hazard', 'note', 'photo', 'report')),
  report            text check (char_length(report) <= 20),
  note              text check (char_length(note) <= 60),
  lat               double precision not null check (lat between -90 and 90),
  lon               double precision not null check (lon between -180 and 180),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status            text not null default 'active' check (status in ('active', 'cleared')),
  cleared_by        uuid references public.profiles (id) on delete set null,
  cleared_at        timestamptz,
  last_confirmed_at timestamptz not null default now(),
  confirmations     int not null default 0,
  check ((audience = 'group') = (group_id is not null))
);
create index if not exists shared_pins_status on public.shared_pins (status, audience);

-- One vote per rider per pin: "still there" or "cleared". The latest vote sets the hazard's status.
create table if not exists public.hazard_votes (
  pin_id   uuid not null references public.shared_pins (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  vote     text not null check (vote in ('there', 'cleared')),
  voted_at timestamptz not null default now(),
  primary key (pin_id, rider_id)
);

create or replace function public.pin_visible(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shared_pins s where s.id = p and (s.audience = 'all' or public.is_group_member(s.group_id)))
$$;

create or replace function public.apply_hazard_vote() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.vote = 'cleared' then
    update public.shared_pins set status = 'cleared', cleared_by = new.rider_id, cleared_at = now() where id = new.pin_id;
  else
    update public.shared_pins set status = 'active', cleared_by = null, cleared_at = null, last_confirmed_at = now(),
           confirmations = (select count(*) from public.hazard_votes v where v.pin_id = new.pin_id and v.vote = 'there')
     where id = new.pin_id;
  end if;
  return new;
end $$;
drop trigger if exists hazard_vote on public.hazard_votes;
create trigger hazard_vote after insert or update on public.hazard_votes for each row execute function public.apply_hazard_vote();

alter table public.shared_pins enable row level security;
alter table public.hazard_votes enable row level security;

drop policy if exists "see shared pins" on public.shared_pins;
create policy "see shared pins" on public.shared_pins for select to authenticated
  using (audience = 'all' or public.is_group_member(group_id));
drop policy if exists "share own pins" on public.shared_pins;
create policy "share own pins" on public.shared_pins for insert to authenticated
  with check (rider_id = auth.uid() and status = 'active' and (audience = 'all' or public.is_group_member(group_id)));
drop policy if exists "edit own pins" on public.shared_pins;
create policy "edit own pins" on public.shared_pins for update to authenticated
  using (rider_id = auth.uid()) with check (rider_id = auth.uid() and (audience = 'all' or public.is_group_member(group_id)));
drop policy if exists "remove own pins or as reviewer" on public.shared_pins;
create policy "remove own pins or as reviewer" on public.shared_pins for delete to authenticated
  using (rider_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_reviewer or p.is_admin)));

drop policy if exists "see votes" on public.hazard_votes;
create policy "see votes" on public.hazard_votes for select to authenticated using (public.pin_visible(pin_id));
drop policy if exists "vote" on public.hazard_votes;
create policy "vote" on public.hazard_votes for insert to authenticated with check (rider_id = auth.uid() and public.pin_visible(pin_id));
drop policy if exists "change vote" on public.hazard_votes;
create policy "change vote" on public.hazard_votes for update to authenticated using (rider_id = auth.uid()) with check (rider_id = auth.uid());

revoke all on public.shared_pins, public.hazard_votes from anon, authenticated;
grant select, insert, delete on public.shared_pins to authenticated;
-- Riders can move their pin, change its note or who it's shared with; status changes only through votes.
grant update (audience, group_id, kind, report, note, lat, lon, updated_at) on public.shared_pins to authenticated;
grant select, insert, update on public.hazard_votes to authenticated;
revoke execute on function public.pin_visible(uuid) from public, anon;
grant execute on function public.pin_visible(uuid) to authenticated;
