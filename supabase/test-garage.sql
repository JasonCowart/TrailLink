-- Behaviour checks for 005-garage.sql (run after test-admin.sql). Any failure aborts with an error.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into vehicles (id, nickname, make, model, width_in, tire_in, lift_in, lockers, skids)
  values ('00000000-0000-0000-0000-0000000000f1', 'Stocky', 'Polaris', 'General', 64, 28, 0, 'none', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into vehicles (id, nickname, width_in, tire_in, lift_in, lockers, skids, sliders)
  values ('00000000-0000-0000-0000-0000000000f2', 'Rock Crawler', 72, 35, 3, 'both', true, true);
-- Kim can't edit or delete Maria's vehicle, or add one in her name.
update vehicles set tire_in = 40 where id = '00000000-0000-0000-0000-0000000000f1';
delete from vehicles where id = '00000000-0000-0000-0000-0000000000f1';
do $$ begin
  if (select tire_in from vehicles where id = '00000000-0000-0000-0000-0000000000f1') <> 28 then raise exception 'rider changed another rider''s vehicle'; end if;
  begin
    insert into vehicles (owner_id, nickname) values ('00000000-0000-0000-0000-00000000000b', 'Fake');
    raise exception 'rider added a vehicle for someone else';
  exception when insufficient_privilege then null; end;
end $$;
-- Ratings carry the rig. Two trails, each rated by a stock rig (1.5) and a built rig (9.0).
insert into ratings (tid, difficulty, vehicle_id, rig_score) values ('USFS:T:1', 4, '00000000-0000-0000-0000-0000000000f2', 9.0), ('USFS:T:2', 5, '00000000-0000-0000-0000-0000000000f2', 9.0);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into ratings (tid, difficulty, vehicle_id, rig_score) values ('USFS:T:1', 7, '00000000-0000-0000-0000-0000000000f1', 1.5), ('USFS:T:2', 8, '00000000-0000-0000-0000-0000000000f1', 1.5);
do $$ begin
  if (select rig_avg from trail_scores where tid = 'USFS:T:1') <> 5.3 then raise exception 'rig average wrong: %', (select rig_avg from trail_scores where tid = 'USFS:T:1'); end if;
  if (select pairs from rig_model) <> 4 then raise exception 'rig model pairs wrong'; end if;
  -- 3 levels easier over 7.5 rig points = 0.4 per point.
  if (select slope from rig_model) <> 0.4 then raise exception 'rig model slope wrong: %', (select slope from rig_model); end if;
end $$;
-- Deleting a vehicle keeps the rating and its rig score.
delete from vehicles where id = '00000000-0000-0000-0000-0000000000f1';
do $$ begin
  if (select rig_score from ratings where tid = 'USFS:T:1' and rider_id = auth.uid()) <> 1.5 then raise exception 'rating lost its rig score'; end if;
  if (select vehicle_id from ratings where tid = 'USFS:T:1' and rider_id = auth.uid()) is not null then raise exception 'rating still points at deleted vehicle'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from vehicles limit 1; raise exception 'anon could read vehicles'; exception when insufficient_privilege then null; end;
  begin perform 1 from rig_model; raise exception 'anon could read rig model'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ALL GARAGE CHECKS PASSED' as result;
