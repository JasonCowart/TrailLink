-- Behaviour checks for 009-badges.sql (run after test-shared-pins.sql). Any failure aborts with an error.
set role authenticated;
-- Jason (a) is the admin and adds a badge trail; Kim (c) can't.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into badge_trails (id, name, tids, geom, difficulty) values ('00000000-0000-0000-0000-0000000000b1', 'Test Pass', '{USFS:1:2}', '{"type":"MultiLineString","coordinates":[[[-105,39],[-105.01,39.01]]]}', 6);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  begin
    insert into badge_trails (name, geom) values ('Fake', '{}');
    raise exception 'non-admin added a badge trail';
  exception when insufficient_privilege then null; end;
  if not exists (select 1 from badge_trails where name = 'Test Pass') then raise exception 'riders cannot see badge trails'; end if;
end $$;
update badge_trails set name = 'Hacked' where id = '00000000-0000-0000-0000-0000000000b1';
delete from badge_trails where id = '00000000-0000-0000-0000-0000000000b1';
-- Kim earns it; she can't award badges to someone else or change one.
insert into badge_awards (badge, detail) values ('trail:00000000-0000-0000-0000-0000000000b1', '{"coverage":0.9}');
do $$ begin
  if (select name from badge_trails where id = '00000000-0000-0000-0000-0000000000b1') <> 'Test Pass' then raise exception 'non-admin changed a badge trail'; end if;
  begin
    insert into badge_awards (rider_id, badge) values ('00000000-0000-0000-0000-00000000000b', 'm:first_ride');
    raise exception 'awarded a badge to someone else';
  exception when insufficient_privilege then null; end;
  begin update badge_awards set earned_at = now() - interval '1 year'; raise exception 'changed an award'; exception when insufficient_privilege then null; end;
end $$;
-- Other riders can see it (for "who has this badge").
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from badge_awards where badge like 'trail:%') <> 1 then raise exception 'awards not visible'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from badge_trails limit 1; raise exception 'anon could read badge trails'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ALL BADGE CHECKS PASSED' as result;
