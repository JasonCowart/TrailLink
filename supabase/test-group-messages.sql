-- Behaviour checks for 012-group-messages.sql (run last). Any failure aborts with an error.
set role authenticated;
-- Maria (b) starts "Canyon Run"; Kim (c) joins; Jason (a) is not in it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
create temp table cr as select * from create_group('Canyon Run');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select join_group((select code from cr));
insert into group_messages (id, group_id, kind, body) values ('10000000-0000-4000-8000-000000000001', (select id from cr), 'quick', 'Stopping');
insert into group_messages (id, group_id, kind, body, lat, lon) values ('10000000-0000-4000-8000-000000000002', (select id from cr), 'location', 'Here', 38.5, -109.5);
-- Kim replies to her own "Stopping" (the app sends reply_to).
insert into group_messages (id, group_id, body, reply_to) values ('10000000-0000-4000-8000-000000000003', (select id from cr), 'Back in 5', '10000000-0000-4000-8000-000000000001');
-- A help alert and its all-clear are allowed kinds; nonsense kinds aren't.
insert into group_messages (id, group_id, kind, body, lat, lon) values ('10000000-0000-4000-8000-000000000004', (select id from cr), 'help', 'Need help', 38.5, -109.5);
insert into group_messages (id, group_id, kind, body, reply_to) values ('10000000-0000-4000-8000-000000000005', (select id from cr), 'helpclear', 'I''m OK', '10000000-0000-4000-8000-000000000004');
do $$ begin
  begin insert into group_messages (id, group_id, kind, body) values (gen_random_uuid(), (select id from cr), 'shout', 'x'); raise exception 'bad kind accepted'; exception when check_violation then null; end;
end $$;
-- Sending the same message twice (offline retry) is refused, not duplicated.
do $$ begin
  begin
    insert into group_messages (id, group_id, body) values ('10000000-0000-4000-8000-000000000001', (select id from cr), 'Stopping');
    raise exception 'duplicate message accepted';
  exception when unique_violation then null; end;
  begin
    insert into group_messages (id, group_id, rider_id, body) values (gen_random_uuid(), (select id from cr), '00000000-0000-0000-0000-00000000000b', 'fake');
    raise exception 'sent a message as someone else';
  exception when insufficient_privilege then null; end;
end $$;
-- Jason can't read or post.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if exists (select 1 from group_messages where group_id = (select id from cr)) then raise exception 'outsider read group messages'; end if;
  begin
    insert into group_messages (id, group_id, body) values (gen_random_uuid(), (select id from cr), 'hi');
    raise exception 'outsider posted to the group';
  exception when insufficient_privilege then null; end;
end $$;
-- Maria reads both. Then everyone leaves: the group is gone, but the ride log stays readable to its riders.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from group_messages where group_id = (select id from cr)) <> 5 then raise exception 'member cannot read messages'; end if;
  if (select reply_to from group_messages where id = '10000000-0000-4000-8000-000000000003') <> '10000000-0000-4000-8000-000000000001' then raise exception 'reply link lost'; end if;
end $$;
select leave_group((select id from cr));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select leave_group((select id from cr));
do $$ begin
  if exists (select 1 from groups where id = (select id from cr)) then raise exception 'empty group not removed'; end if;
  if (select count(*) from group_messages where group_id = (select id from cr)) <> 5 then raise exception 'ride log lost after the group ended'; end if;
  if (select group_name from group_log_members where group_id = (select id from cr)) <> 'Canyon Run' then raise exception 'ride log lost the group name'; end if;
  begin
    insert into group_messages (id, group_id, body) values (gen_random_uuid(), (select id from cr), 'late');
    raise exception 'posted to a group after leaving';
  exception when insufficient_privilege then null; end;
end $$;
-- Push subscriptions: own only.
insert into push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/kim', 'k', 'a');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if exists (select 1 from push_subscriptions) then raise exception 'saw another rider''s phone'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from group_messages limit 1; raise exception 'anon read messages'; exception when insufficient_privilege then null; end;
end $$;
reset role;
