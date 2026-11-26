-- Behaviour checks for 004-admin.sql (run after test.sql). Any failure aborts with an error.
update auth.users set email = v.email, created_at = v.created from (values
  ('00000000-0000-0000-0000-00000000000a'::uuid, 'Jason@Example.com', now() - interval '4 days'),
  ('00000000-0000-0000-0000-00000000000b'::uuid, 'maria@example.com', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000000c'::uuid, 'kim@example.com',   now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000000d'::uuid, 'dean@example.com',  now() - interval '1 day')) v(id, email, created)
 where users.id = v.id;
-- Applying 004 to a project that already has riders: they stay approved and the first account becomes admin.
\i supabase/004-admin.sql
do $$ begin
  if (select count(*) from invites) <> 4 then raise exception 'existing riders not added to the invite list'; end if;
  if (select array_agg(display_name) from profiles where is_admin) <> array['Jason'] then raise exception 'first account is not the only admin'; end if;
end $$;
\i supabase/004-admin.sql
do $$ begin
  if (select count(*) from profiles where is_admin) <> 1 then raise exception '004 not safe to rerun'; end if;
end $$;

-- The sign-in hook lets invited emails through and turns everyone else away.
set role supabase_auth_admin;
do $$ begin
  if public.before_user_created('{"user":{"email":"KIM@example.com"}}') <> '{}'::jsonb then raise exception 'invited email refused'; end if;
  if public.before_user_created('{"user":{"email":"stranger@example.com"}}') -> 'error' ->> 'http_code' <> '403' then raise exception 'uninvited email allowed'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('authenticated', 'public.before_user_created(jsonb)', 'execute') then raise exception 'app can call the sign-in hook'; end if;
  if has_function_privilege('anon', 'public.admin_riders()', 'execute') then raise exception 'visitors can call admin tools'; end if;
end $$;

-- A regular rider can't use admin tools, read the invite list or promote themselves.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  begin perform * from admin_riders(); raise exception 'rider listed riders'; exception when insufficient_privilege then null; end;
  begin perform admin_invite('friend@example.com'); raise exception 'rider invited someone'; exception when insufficient_privilege then null; end;
  begin perform 1 from invites; raise exception 'rider read invite list'; exception when insufficient_privilege then null; end;
  begin update profiles set is_admin = true where id = auth.uid(); raise exception 'rider made self admin'; exception when insufficient_privilege then null; end;
  begin insert into profiles (id, display_name, is_admin) values (auth.uid(), 'x', true); raise exception 'rider inserted admin profile'; exception when insufficient_privilege then null; end;
end $$;
update profiles set display_name = 'Maria G' where id = auth.uid();

-- The admin invites, lists, promotes and removes riders.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select admin_invite(' New.Rider@Example.com ');
do $$ begin
  begin perform admin_invite('not an email'); raise exception 'bad email accepted'; exception when invalid_parameter_value then null; end;
  if (select count(*) from admin_riders()) <> 5 then raise exception 'admin list wrong'; end if;
  if (select joined_at from admin_riders() where email = 'new.rider@example.com') is not null then raise exception 'pending invite shown as joined'; end if;
  if (select ratings from admin_riders() where display_name = 'Jason') <> 1 then raise exception 'contribution counts wrong'; end if;
end $$;
select admin_set_role('00000000-0000-0000-0000-00000000000b', true, false);
select admin_remove('DEAN@example.com');
do $$ begin
  if not (select is_reviewer from profiles where display_name = 'Maria G') then raise exception 'reviewer not set'; end if;
  if exists (select 1 from profiles where display_name = 'Dean') then raise exception 'removed rider still has a profile'; end if;
  if (select count(*) from admin_riders()) <> 4 then raise exception 'removed rider still listed'; end if;
  begin perform admin_remove('jason@example.com'); raise exception 'admin removed self'; exception when invalid_parameter_value then null; end;
  begin perform admin_set_role('00000000-0000-0000-0000-00000000000a', true, false); raise exception 'admin demoted self'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
set role supabase_auth_admin;
do $$ begin
  if public.before_user_created('{"user":{"email":"new.rider@example.com"}}') <> '{}'::jsonb then raise exception 'new invite refused'; end if;
  if public.before_user_created('{"user":{"email":"dean@example.com"}}') = '{}'::jsonb then raise exception 'removed rider can sign up again'; end if;
end $$;
reset role;
select 'ALL ADMIN CHECKS PASSED' as result;
