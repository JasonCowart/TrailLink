-- Behaviour checks for 007-shared-pins.sql (run after test-groups.sql). Any failure aborts with an error.
set role authenticated;
-- Maria (b) reports a downed tree for everyone; Kim (c) starts a group and shares a regroup point with it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into shared_pins (id, audience, kind, report, lat, lon) values ('00000000-0000-0000-0000-0000000000a1', 'all', 'report', 'tree', 39.1, -105.5);
do $$ begin
  begin
    insert into shared_pins (id, audience, kind, lat, lon, status) values ('00000000-0000-0000-0000-0000000000a9', 'all', 'report', 1, 1, 'cleared');
    raise exception 'inserted a pin already cleared';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
create temp table kg as select * from create_group('Kim ride');
insert into shared_pins (id, audience, group_id, kind, lat, lon) values ('00000000-0000-0000-0000-0000000000a2', 'group', (select id from kg), 'regroup', 39.2, -105.4);
-- Jason (a) sees the tree but not Kim's group pin; he can't share into a group he's not in.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if not exists (select 1 from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'hazard not visible to all riders'; end if;
  if exists (select 1 from shared_pins where id = '00000000-0000-0000-0000-0000000000a2') then raise exception 'group pin visible outside group'; end if;
  begin
    insert into shared_pins (id, audience, group_id, kind, lat, lon) values ('00000000-0000-0000-0000-0000000000a3', 'group', (select id from kg), 'note', 1, 1);
    raise exception 'shared into someone else''s group';
  exception when insufficient_privilege then null; end;
  begin update shared_pins set status = 'cleared' where id = '00000000-0000-0000-0000-0000000000a1'; raise exception 'set status directly'; exception when insufficient_privilege then null; end;
end $$;
-- Jason can't move or delete Maria's report (no error, nothing changes).
update shared_pins set lat = 0 where id = '00000000-0000-0000-0000-0000000000a1';
delete from shared_pins where id = '00000000-0000-0000-0000-0000000000a1';
-- Jason says it's still there, then on a later ride says it's cleared.
insert into hazard_votes (pin_id, vote) values ('00000000-0000-0000-0000-0000000000a1', 'there');
do $$ begin
  if (select lat from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') <> 39.1 then raise exception 'rider moved someone else''s pin'; end if;
  if (select confirmations from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') <> 1 then raise exception 'still-there not counted'; end if;
end $$;
update hazard_votes set vote = 'cleared', voted_at = now() where pin_id = '00000000-0000-0000-0000-0000000000a1' and rider_id = auth.uid();
do $$ begin
  if (select status from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') <> 'cleared' then raise exception 'hazard not cleared'; end if;
  if (select cleared_by from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') <> auth.uid() then raise exception 'cleared_by wrong'; end if;
end $$;
-- Kim disagrees: still there reopens it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into hazard_votes (pin_id, vote) values ('00000000-0000-0000-0000-0000000000a1', 'there');
do $$ begin
  if (select status from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') <> 'active' then raise exception 'still-there did not reopen'; end if;
end $$;
-- Maria (a reviewer from test-admin) can remove any pin; the reporter can remove their own.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
delete from shared_pins where id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  if exists (select 1 from shared_pins where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'reporter could not remove'; end if;
end $$;
-- When the group ends, its pins go with it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select leave_group((select id from kg));
reset role;
do $$ begin
  if exists (select 1 from shared_pins where id = '00000000-0000-0000-0000-0000000000a2') then raise exception 'group pin kept after group ended'; end if;
end $$;
set role anon;
do $$ begin
  begin perform 1 from shared_pins limit 1; raise exception 'anon could read pins'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ALL SHARED PIN CHECKS PASSED' as result;
