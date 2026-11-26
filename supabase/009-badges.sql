-- TrailLink: trail badges. The admin picks "badge trails"; a rider earns one when a recorded ride covers most of it
-- (checked on the phone, so it works offline). Milestone badges (miles, first Extreme trail, ...) are earned the same way.
-- Awards are kept here so a rider's badge wall follows them to a new phone. Safe to run more than once.

create table if not exists public.badge_trails (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  description  text check (char_length(description) <= 300),
  tids         text[] not null default '{}',          -- the map's trail ids this badge trail is made of
  geom         jsonb not null,                         -- GeoJSON MultiLineString [[lon, lat], ...] used for the coverage check
  difficulty   smallint check (difficulty between 1 and 10),
  color        text not null default '#E8501A' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon         text not null default 'peak' check (char_length(icon) <= 20),
  min_coverage smallint not null default 80 check (min_coverage between 30 and 100),
  active       boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.badge_awards (
  rider_id  uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  badge     text not null check (char_length(badge) <= 80),   -- 'trail:<badge trail id>' or 'm:<milestone>'
  earned_at timestamptz not null default now(),
  detail    jsonb,                                           -- e.g. {"coverage": 0.86, "ride": "Ride 11/26"}
  primary key (rider_id, badge)
);

alter table public.badge_trails enable row level security;
alter table public.badge_awards enable row level security;

drop policy if exists "riders see badge trails" on public.badge_trails;
create policy "riders see badge trails" on public.badge_trails for select to authenticated using (true);
drop policy if exists "admin manages badge trails" on public.badge_trails;
create policy "admin manages badge trails" on public.badge_trails for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "riders see badges" on public.badge_awards;
create policy "riders see badges" on public.badge_awards for select to authenticated using (true);
drop policy if exists "earn own badges" on public.badge_awards;
create policy "earn own badges" on public.badge_awards for insert to authenticated with check (rider_id = auth.uid());

revoke all on public.badge_trails, public.badge_awards from anon, authenticated;
grant select, insert, update, delete on public.badge_trails to authenticated;
grant select, insert on public.badge_awards to authenticated;
