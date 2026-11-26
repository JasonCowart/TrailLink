-- TrailLink: the Garage. Riders save their vehicles; each rating records the rig it was ridden in, so the
-- app can forecast how hard a trail will feel in a better- or less-equipped vehicle. Safe to run more than once.

create table if not exists public.vehicles (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  nickname   text not null check (char_length(nickname) between 1 and 40),
  make       text check (char_length(make) <= 40),
  model      text check (char_length(model) <= 60),
  year       smallint check (year between 1980 and 2100),
  width_in   smallint not null default 64 check (width_in in (50, 64, 72)),
  tire_in    smallint not null default 28 check (tire_in between 20 and 45),
  lift_in    numeric(3, 1) not null default 0 check (lift_in between 0 and 12),
  lockers    text not null default 'none' check (lockers in ('none', 'rear', 'both')),
  winch      boolean not null default false,
  skids      boolean not null default false,
  sliders    boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists vehicles_owner on public.vehicles (owner_id);

alter table public.vehicles enable row level security;
drop policy if exists "vehicles readable" on public.vehicles;
create policy "vehicles readable" on public.vehicles for select to authenticated using (true);
drop policy if exists "own vehicle insert" on public.vehicles;
create policy "own vehicle insert" on public.vehicles for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "own vehicle update" on public.vehicles;
create policy "own vehicle update" on public.vehicles for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own vehicle delete" on public.vehicles;
create policy "own vehicle delete" on public.vehicles for delete to authenticated using (owner_id = auth.uid());
revoke all on public.vehicles from anon;
grant select, insert, update, delete on public.vehicles to authenticated;

-- Each rating remembers the vehicle and its rig score (0-10) at the time, so upgrading later doesn't rewrite history.
alter table public.ratings add column if not exists vehicle_id uuid references public.vehicles (id) on delete set null;
alter table public.ratings add column if not exists rig_score numeric(3, 1) check (rig_score between 0 and 10);

-- Community score per trail, now with the average rig of the riders who rated it.
create or replace view public.trail_scores with (security_invoker = true) as
select tid,
       count(*)::int as count,
       round(case when count(*) >= 5
                  then (sum(difficulty) - max(difficulty) - min(difficulty))::numeric / (count(*) - 2)
                  else avg(difficulty) end, 1) as avg,
       max(rated_at) as last_rated,
       round(avg(rig_score), 1) as rig_avg
from public.ratings
group by tid;

-- How much a better rig lowers the felt difficulty, measured across trails rated by differently built rigs:
-- difficulty levels per rig-score point (within-trail regression). The app uses it once pairs >= 30.
create or replace view public.rig_model with (security_invoker = true) as
with r as (
  select difficulty, rig_score,
         avg(rig_score) over (partition by tid) as trail_rig, avg(difficulty) over (partition by tid) as trail_diff,
         count(*) over (partition by tid) as n
    from public.ratings where rig_score is not null
)
select count(*)::int as pairs,
       case when sum((rig_score - trail_rig) ^ 2) > 0
            then round(-sum((rig_score - trail_rig) * (difficulty - trail_diff)) / sum((rig_score - trail_rig) ^ 2), 3) end as slope
  from r where n >= 2;

revoke all on public.trail_scores, public.rig_model from anon;
grant select on public.trail_scores, public.rig_model to authenticated;
