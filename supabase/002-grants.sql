-- TrailLink: let the app use the community tables. Row-level security (from schema.sql) still decides
-- WHICH rows each rider can read or change; these grants only open the doors it guards.
grant usage on schema public to anon, authenticated;

grant select on public.profiles, public.ratings, public.rider_trails, public.trail_confirmations to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.ratings to authenticated;
grant insert, update, delete on public.rider_trails to authenticated;
grant insert, delete on public.trail_confirmations to authenticated;
grant select on public.trail_scores, public.rider_trails_public to anon, authenticated;
