-- TrailLink: three pretend riders the admin can add to a group to try the app alone (moving dots, chat, replies,
-- notifications). They can't sign in (no password) and are hidden from the admin's rider list. Safe to run more than once.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'kim@test-riders.traillink.invalid', '{"provider":"email","test_rider":true}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'dean@test-riders.traillink.invalid', '{"provider":"email","test_rider":true}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'maria@test-riders.traillink.invalid', '{"provider":"email","test_rider":true}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, display_name) values
  ('d0000000-0000-4000-8000-000000000001', 'Kim (test)'),
  ('d0000000-0000-4000-8000-000000000002', 'Dean (test)'),
  ('d0000000-0000-4000-8000-000000000003', 'Maria (test)')
on conflict (id) do nothing;

-- Keep them out of the admin's rider list.
create or replace function public.admin_riders() returns table (
  email text, rider_id uuid, display_name text, invited_at timestamptz, joined_at timestamptz, last_seen timestamptz,
  is_reviewer boolean, is_admin boolean, ratings int, trails int
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_check();
  return query
  select coalesce(i.email, lower(u.email))::text, u.id, p.display_name, i.invited_at, u.created_at, u.last_sign_in_at,
         coalesce(p.is_reviewer, false), coalesce(p.is_admin, false),
         (select count(*)::int from public.ratings r where r.rider_id = u.id),
         (select count(*)::int from public.rider_trails t where t.created_by = u.id)
    from public.invites i
    full join auth.users u on lower(u.email) = i.email
    left join public.profiles p on p.id = u.id
   where coalesce(u.email, '') not like '%@test-riders.traillink.invalid'
   order by u.created_at is null, coalesce(p.display_name, i.email, u.email::text);
end $$;

-- The server functions (notifications, test riders) run as Supabase's service role: it needs table access.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'alter default privileges in schema public grant select, insert, update, delete on tables to service_role';
  end if;
end $$;
