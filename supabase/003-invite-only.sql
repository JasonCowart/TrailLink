-- TrailLink: invite-only. Only signed-in riders (who can only exist if you invited them, once open sign-ups
-- are turned off in Supabase) can read community data. Visitors who aren't signed in see nothing from the database.
-- Safe to run more than once.

-- Tables: reading needs a signed-in rider.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);

drop policy if exists "ratings readable" on public.ratings;
create policy "ratings readable" on public.ratings for select to authenticated using (true);

drop policy if exists "trails readable" on public.rider_trails;
create policy "trails readable" on public.rider_trails for select to authenticated using (not hidden or created_by = auth.uid());

drop policy if exists "confirmations readable" on public.trail_confirmations;
create policy "confirmations readable" on public.trail_confirmations for select to authenticated using (true);

-- Views run with the reader's permissions, so the rules above apply to them too.
alter view public.trail_scores set (security_invoker = true);
alter view public.rider_trails_public set (security_invoker = true);

-- Visitors who aren't signed in get no access at all.
revoke all on public.profiles, public.ratings, public.rider_trails, public.trail_confirmations from anon;
revoke all on public.trail_scores, public.rider_trails_public from anon;
