-- TrailLink: invite list and admin tools. Safe to run more than once.
-- The admin approves riders by email in the app. Approved riders create their account the first time they
-- sign in; Supabase asks public.before_user_created first and refuses any email that isn't on the list.

-- ---------------------------------------------------------------- admin flag
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Riders can set only their own name and vehicle; reviewer and admin flags are set through the admin tools.
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name, vehicle) on public.profiles to authenticated;
grant update (display_name, vehicle) on public.profiles to authenticated;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------- invite list
create table if not exists public.invites (
  email      text primary key check (email = lower(email) and email like '%_@_%._%' and char_length(email) <= 254),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now()
);
alter table public.invites enable row level security;
-- No direct access for anyone using the app; only the admin functions below read or change it.
revoke all on public.invites from anon, authenticated;

-- Riders who signed up before the invite list existed stay approved.
insert into public.invites (email) select lower(email) from auth.users where email is not null on conflict do nothing;
-- The project owner (first account) is the first admin.
update public.profiles set is_admin = true
 where id = (select id from auth.users order by created_at limit 1)
   and not exists (select 1 from public.profiles where is_admin);

-- ---------------------------------------------------------------- invite check (Supabase "Before User Created" hook)
create or replace function public.before_user_created(event jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(event -> 'user' ->> 'email'));
begin
  if e is not null and exists (select 1 from public.invites where email = e) then return '{}'::jsonb; end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'That email hasn''t been invited to TrailLink. Ask your ride leader for an invite.'));
end $$;
revoke execute on function public.before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------- admin tools (called from the app's Admin page)
create or replace function public.admin_check() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only a TrailLink admin can do that' using errcode = '42501'; end if;
end $$;

-- Everyone invited or signed up: email, whether they've joined, and what they've contributed.
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
   order by u.created_at is null, coalesce(p.display_name, i.email, u.email::text);
end $$;

create or replace function public.admin_invite(p_email text) returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  perform public.admin_check();
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That doesn''t look like an email address' using errcode = '22023'; end if;
  insert into public.invites (email, invited_by) values (e, auth.uid()) on conflict (email) do nothing;
end $$;

-- Removes the invite and, if they've joined, their account (with their ratings and trails).
create or replace function public.admin_remove(p_email text) returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  perform public.admin_check();
  if exists (select 1 from auth.users where id = auth.uid() and lower(email) = e) then
    raise exception 'You can''t remove yourself' using errcode = '22023';
  end if;
  delete from public.invites where email = e;
  delete from auth.users where lower(email) = e;
end $$;

create or replace function public.admin_set_role(p_rider uuid, p_reviewer boolean, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if p_rider = auth.uid() and not p_admin then raise exception 'You can''t remove your own admin access' using errcode = '22023'; end if;
  update public.profiles set is_reviewer = p_reviewer or p_admin, is_admin = p_admin where id = p_rider;
end $$;

revoke execute on function public.admin_check(), public.admin_riders(), public.admin_invite(text), public.admin_remove(text),
  public.admin_set_role(uuid, boolean, boolean) from public, anon;
grant execute on function public.is_admin(), public.admin_riders(), public.admin_invite(text), public.admin_remove(text),
  public.admin_set_role(uuid, boolean, boolean) to authenticated;
