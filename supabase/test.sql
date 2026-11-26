-- Behaviour checks for schema.sql (run after test-stub.sql and schema.sql). Any failure aborts with an error.
grant usage on schema public, auth to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant execute on function auth.uid() to authenticated, anon;

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into profiles (id, display_name) values (auth.uid(), 'Jason');
insert into ratings (tid, difficulty) values ('USFS:0402:30813', 6);
insert into rider_trails (name, difficulty, vehicles, geom) values ('Test loop', 5, 'utv', st_geomfromtext('LINESTRING(-105 39, -105.01 39.01)', 4326));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into profiles (id, display_name) values (auth.uid(), 'Maria');
insert into ratings (tid, difficulty) values ('USFS:0402:30813', 4);
-- Maria cannot change Jason's rating (row-level security hides it from her update).
update ratings set difficulty = 1 where rider_id = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select difficulty from ratings where rider_id = '00000000-0000-0000-0000-00000000000a') <> 6 then raise exception 'another rider changed a rating'; end if;
  if (select avg from trail_scores where tid = 'USFS:0402:30813') <> 5.0 then raise exception 'community average wrong'; end if;
end $$;
-- Maria confirms Jason's trail; Jason cannot confirm his own.
insert into trail_confirmations (trail_id) select id from rider_trails where name = 'Test loop';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  begin
    insert into trail_confirmations (trail_id) select id from rider_trails where name = 'Test loop';
    raise exception 'creator was allowed to confirm own trail';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into profiles (id, display_name) values (auth.uid(), 'Kim');
insert into trail_confirmations (trail_id) select id from rider_trails where name = 'Test loop';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
insert into profiles (id, display_name) values (auth.uid(), 'Dean');
insert into trail_confirmations (trail_id) select id from rider_trails where name = 'Test loop';
do $$ begin
  if not (select verified from rider_trails_public where name = 'Test loop') then raise exception 'trail not verified after 3 confirmations'; end if;
  if (select created_by from rider_trails_public where name = 'Test loop') <> 'Jason' then raise exception 'creator name missing'; end if;
end $$;
-- A rider can't make themselves a reviewer.
do $$ begin
  begin
    update profiles set is_reviewer = true where id = auth.uid();
    raise exception 'rider made self reviewer';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ALL DATABASE CHECKS PASSED' as result;
