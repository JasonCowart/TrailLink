-- Behaviour checks for 006-groups.sql (run after test-garage.sql). Any failure aborts with an error.
set role authenticated;
-- Maria (b) starts a group; Kim (c) joins with the code; Jason (a) doesn't.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
create temp table g as select * from create_group('Saturday Ride');
do $$ begin
  if (select code from g) !~ '^[A-Z2-9]{6}$' then raise exception 'bad join code'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select join_group(lower((select code from g)));
do $$ begin
  begin perform join_group('ZZZZZZ'); raise exception 'joined with a wrong code'; exception when invalid_parameter_value then null; end;
  if (select count(*) from group_members where group_id = (select id from g)) <> 2 then raise exception 'members not visible to a member'; end if;
end $$;
-- Kim can't post a position until she turns sharing on.
do $$ begin
  begin
    insert into group_positions (group_id, lat, lon) values ((select id from g), 39.1, -105.5);
    raise exception 'posted position without sharing';
  exception when insufficient_privilege then null; end;
end $$;
update group_members set sharing = true where group_id = (select id from g) and rider_id = auth.uid();
insert into group_positions (group_id, lat, lon) values ((select id from g), 39.1, -105.5);
-- Kim can't switch on sharing for Maria or post as Maria.
update group_members set sharing = true where group_id = (select id from g) and rider_id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select sharing from group_members where rider_id = '00000000-0000-0000-0000-00000000000b' and group_id = (select id from g)) then raise exception 'turned on sharing for someone else'; end if;
  begin
    insert into group_positions (group_id, rider_id, lat, lon) values ((select id from g), '00000000-0000-0000-0000-00000000000b', 1, 1);
    raise exception 'posted a position as someone else';
  exception when insufficient_privilege then null; end;
  begin update group_members set joined_at = now() where rider_id = auth.uid(); raise exception 'changed joined_at'; exception when insufficient_privilege then null; end;
end $$;
-- Maria sees Kim's position; Jason sees nothing of the group.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from group_positions where group_id = (select id from g)) <> 1 then raise exception 'member cannot see sharing rider'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if exists (select 1 from groups) or exists (select 1 from group_members) or exists (select 1 from group_positions) then raise exception 'outsider can see the group'; end if;
  begin insert into groups (name, code) values ('x', 'ABCDEF'); raise exception 'made a group directly'; exception when insufficient_privilege then null; end;
end $$;
-- Turning sharing off removes the position; leaving removes the membership; the last one out deletes the group.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
update group_members set sharing = false where group_id = (select id from g) and rider_id = auth.uid();
do $$ begin
  if exists (select 1 from group_positions where rider_id = auth.uid()) then raise exception 'position kept after sharing off'; end if;
end $$;
select leave_group((select id from g));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from group_members where group_id = (select id from g)) <> 1 then raise exception 'leaving did not remove member'; end if;
end $$;
select leave_group((select id from g));
reset role;
do $$ begin
  if exists (select 1 from groups where id = (select id from g)) then raise exception 'empty group not deleted'; end if;
end $$;
select 'ALL GROUP CHECKS PASSED' as result;
