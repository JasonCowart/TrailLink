-- Stand-ins for what Supabase provides, so CI can test schema.sql on plain PostgreSQL + PostGIS.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
-- Columns of Supabase's auth.users that the admin tools read, and the role Supabase runs sign-in hooks as.
alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists created_at timestamptz not null default now();
alter table auth.users add column if not exists last_sign_in_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
-- More auth.users columns (used by 014-test-riders.sql).
alter table auth.users add column if not exists instance_id uuid;
alter table auth.users add column if not exists aud text;
alter table auth.users add column if not exists role text;
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists raw_user_meta_data jsonb;
alter table auth.users add column if not exists updated_at timestamptz;
