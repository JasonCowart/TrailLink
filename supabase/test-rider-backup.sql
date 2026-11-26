-- Behaviour checks for 011-rider-backup.sql (run after the other tests). Any failure aborts with an error.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into rider_items (kind, id, data) values ('pin', 'p1', '{"id":"p1","kind":"regroup","lat":39,"lon":-105,"t":1}'), ('setting', 'base', '"sat"');
-- Upsert as the app does; a later change gets a later stamp.
do $$ declare t1 timestamptz; t2 timestamptz; begin
  select updated_at into t1 from rider_items where id = 'p1';
  perform pg_sleep(0.01);
  insert into rider_items (kind, id, data) values ('pin', 'p1', '{"id":"p1","kind":"regroup","lat":39.5,"lon":-105,"t":1}')
    on conflict (rider_id, kind, id) do update set data = excluded.data, deleted = excluded.deleted;
  select updated_at into t2 from rider_items where id = 'p1';
  if t2 <= t1 then raise exception 'change was not re-stamped'; end if;
  if (select (data->>'lat')::float from rider_items where id = 'p1') <> 39.5 then raise exception 'upsert did not update'; end if;
end $$;
-- Deleting keeps a marker (so other phones remove it too) and drops the data.
insert into rider_items (kind, id, data, deleted) values ('pin', 'p1', '{"x":1}', true)
  on conflict (rider_id, kind, id) do update set data = excluded.data, deleted = excluded.deleted;
do $$ begin
  if (select data from rider_items where id = 'p1') is not null then raise exception 'deleted item kept its data'; end if;
end $$;
-- Another rider can't see, change or add to Maria's backup.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  if exists (select 1 from rider_items) then raise exception 'rider saw another rider''s backup'; end if;
  begin
    insert into rider_items (rider_id, kind, id, data) values ('00000000-0000-0000-0000-00000000000b', 'pin', 'x', '{}');
    raise exception 'rider wrote into another rider''s backup';
  exception when insufficient_privilege then null; end;
end $$;
update rider_items set data = '"topo"' where id = 'base';
delete from rider_items;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select data from rider_items where id = 'base') <> '"sat"'::jsonb then raise exception 'another rider changed the backup'; end if;
  if (select count(*) from rider_items) <> 2 then raise exception 'another rider deleted from the backup'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from rider_items limit 1; raise exception 'anon could read backups'; exception when insufficient_privilege then null; end;
end $$;
reset role;
