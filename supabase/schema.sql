-- TrailLink community database (PostgreSQL, run in Supabase's SQL editor).
-- Holds what riders contribute: difficulty ratings and rider-created trails.
-- Agency and OpenStreetMap trails stay in the weekly map tiles; ratings point at them by trail id (tid).
--
-- Security: row-level security is on for every table. Anyone can read. Signed-in riders can add
-- their own rows and change or delete only their own. Nobody can edit someone else's rating or trail.

create extension if not exists postgis;

-- ---------------------------------------------------------------- riders
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  vehicle     text check (char_length(vehicle) <= 60),
  is_reviewer boolean not null default false, -- can verify rider-created trails
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- difficulty ratings (one per rider per trail)
create table if not exists public.ratings (
  tid        text not null check (char_length(tid) <= 200), -- e.g. USFS:0402:30813, BLM:UT:..., OSM:123, RIDER:<uuid>
  rider_id   uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  difficulty smallint not null check (difficulty between 1 and 10),
  vehicle    text check (char_length(vehicle) <= 60), -- the rider's setup when they rated (context for others)
  comment    text check (char_length(comment) <= 500),
  rated_at   timestamptz not null default now(),
  primary key (tid, rider_id)
);
create index if not exists ratings_tid on public.ratings (tid);

-- Community rating per trail. Median-like robustness: trimmed mean ignores the single highest and lowest
-- rating once a trail has 5+ ratings, so one outlier can't swing the colour.
create or replace view public.trail_scores as
select tid,
       count(*)::int as count,
       round(case when count(*) >= 5
                  then (sum(difficulty) - max(difficulty) - min(difficulty))::numeric / (count(*) - 2)
                  else avg(difficulty) end, 1) as avg,
       max(rated_at) as last_rated
from public.ratings
group by tid;

-- ---------------------------------------------------------------- rider-created trails
create table if not exists public.rider_trails (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  difficulty  smallint not null check (difficulty between 1 and 10), -- creator's rating; riders' votes go in ratings
  vehicles    text not null default 'unknown' check (vehicles in ('utv', 'narrow', 'moto', 'unknown')),
  notes       text check (char_length(notes) <= 500),
  geom        geometry(LineString, 4326) not null,
  created_by  uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  confirmations int not null default 0,         -- riders who say "I rode this, it's real"
  verified    boolean not null default false,   -- set by a reviewer
  hidden      boolean not null default false    -- set by a reviewer for bad or illegal entries
);
create index if not exists rider_trails_geom on public.rider_trails using gist (geom);

create table if not exists public.trail_confirmations (
  trail_id uuid not null references public.rider_trails (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  confirmed_at timestamptz not null default now(),
  primary key (trail_id, rider_id)
);

-- Keep the confirmation count current, and auto-verify after 3 independent riders confirm.
create or replace function public.count_confirmations() returns trigger language plpgsql security definer as $$
begin
  update public.rider_trails t
     set confirmations = (select count(*) from public.trail_confirmations c where c.trail_id = t.id),
         verified = t.verified or (select count(*) from public.trail_confirmations c where c.trail_id = t.id) >= 3
   where t.id = coalesce(new.trail_id, old.trail_id);
  return null;
end $$;
drop trigger if exists confirmations_changed on public.trail_confirmations;
create trigger confirmations_changed after insert or delete on public.trail_confirmations
  for each row execute function public.count_confirmations();

-- What the app reads: trails as GeoJSON-ready rows with the creator's name.
create or replace view public.rider_trails_public as
select t.id, t.name, t.difficulty, t.vehicles, t.notes, t.created_at, t.confirmations, t.verified,
       p.display_name as created_by, t.created_by as created_by_id,
       st_asgeojson(t.geom)::json as geometry
from public.rider_trails t
join public.profiles p on p.id = t.created_by
where not t.hidden;

-- ---------------------------------------------------------------- row-level security
alter table public.profiles enable row level security;
alter table public.ratings enable row level security;
alter table public.rider_trails enable row level security;
alter table public.trail_confirmations enable row level security;

create policy "profiles readable" on public.profiles for select using (true);
create policy "own profile insert" on public.profiles for insert with check (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and is_reviewer = (select is_reviewer from public.profiles where id = auth.uid()));

create policy "ratings readable" on public.ratings for select using (true);
create policy "own rating insert" on public.ratings for insert with check (rider_id = auth.uid());
create policy "own rating update" on public.ratings for update using (rider_id = auth.uid()) with check (rider_id = auth.uid());
create policy "own rating delete" on public.ratings for delete using (rider_id = auth.uid());

create policy "trails readable" on public.rider_trails for select using (not hidden or created_by = auth.uid());
create policy "own trail insert" on public.rider_trails for insert with check (created_by = auth.uid() and not verified and not hidden and confirmations = 0);
create policy "own trail update" on public.rider_trails for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "reviewer trail update" on public.rider_trails for update using (exists (select 1 from public.profiles where id = auth.uid() and is_reviewer));
create policy "own trail delete" on public.rider_trails for delete using (created_by = auth.uid());

create policy "confirmations readable" on public.trail_confirmations for select using (true);
create policy "confirm others' trails" on public.trail_confirmations for insert with check (
  rider_id = auth.uid() and not exists (select 1 from public.rider_trails t where t.id = trail_id and t.created_by = auth.uid()));
create policy "own confirmation delete" on public.trail_confirmations for delete using (rider_id = auth.uid());

-- Let the app use the tables and views (row-level security above still limits which rows).
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.ratings, public.rider_trails, public.trail_confirmations to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.ratings to authenticated;
grant insert, update, delete on public.rider_trails to authenticated;
grant insert, delete on public.trail_confirmations to authenticated;
grant select on public.trail_scores, public.rider_trails_public to anon, authenticated;
