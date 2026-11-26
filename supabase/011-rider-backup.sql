-- TrailLink: back up each rider's own data (pins, recorded rides, app settings) and photos to their account,
-- so it follows them between Safari, the Home Screen app and a new phone. Private: only the rider can see it.
-- Safe to run more than once.

create table if not exists public.rider_items (
  rider_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('pin', 'track', 'setting')),
  id text not null check (length(id) between 1 and 100),
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (rider_id, kind, id),
  -- A long recorded ride is a few hundred KB; refuse anything absurd.
  constraint rider_items_size check (data is null or pg_column_size(data) < 4000000)
);
create index if not exists rider_items_changed on public.rider_items (rider_id, updated_at);

-- The database stamps every change, so phones with wrong clocks still sync in the right order.
create or replace function public.rider_items_stamp() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  if new.deleted then new.data := null; end if;
  return new;
end $$;
drop trigger if exists rider_items_stamp on public.rider_items;
create trigger rider_items_stamp before insert or update on public.rider_items for each row execute function public.rider_items_stamp();

alter table public.rider_items enable row level security;
drop policy if exists rider_items_own on public.rider_items;
create policy rider_items_own on public.rider_items for all to authenticated
  using (rider_id = auth.uid()) with check (rider_id = auth.uid());
revoke all on public.rider_items from anon;
grant select, insert, update, delete on public.rider_items to authenticated;

-- Photos: a private storage bucket, one folder per rider (rider-photos/<rider id>/<photo id>.jpg).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('rider-photos', 'rider-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists rider_photos_read on storage.objects';
    execute 'drop policy if exists rider_photos_add on storage.objects';
    execute 'drop policy if exists rider_photos_replace on storage.objects';
    execute $p$create policy rider_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy rider_photos_add on storage.objects for insert to authenticated
      with check (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy rider_photos_replace on storage.objects for update to authenticated
      using (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    -- No delete policy: photos are never deleted from the app.
  end if;
end $$;
