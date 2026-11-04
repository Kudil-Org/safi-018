#!/bin/sh
# AWS-only bootstrap for self-hosted Supabase.
#
# GoTrue owns the auth schema and creates auth.users on first start. This script
# waits for that table, then adds the Supabase roles/helpers that vanilla
# Postgres does not have, applies the SAFI migration from the repo, and grants
# the RLS subject roles. It is idempotent and runs as a one-shot compose service.
set -eu

DB_HOST=supabase_db
DB_USER=postgres
DB_NAME=postgres

echo "bootstrap: waiting for postgres"
until pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 2
done

echo "bootstrap: waiting for GoTrue to create auth.users"
i=0
while [ "$i" -lt 90 ]; do
  if [ "$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select to_regclass('auth.users') is not null")" = "t" ]; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$i" -ge 90 ]; then
  echo "bootstrap: auth.users was not created by GoTrue" >&2
  exit 1
fi

echo "bootstrap: creating roles and auth helpers"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -v authenticator_password="$AUTHENTICATOR_PASSWORD" <<'SQL'
select 'create role anon nologin noinherit' where not exists (select 1 from pg_roles where rolname = 'anon')\gexec
select 'create role authenticated nologin noinherit' where not exists (select 1 from pg_roles where rolname = 'authenticated')\gexec
select 'create role service_role nologin noinherit bypassrls' where not exists (select 1 from pg_roles where rolname = 'service_role')\gexec
select 'create role authenticator login noinherit' where not exists (select 1 from pg_roles where rolname = 'authenticator')\gexec
alter role authenticator with login password :'authenticator_password';
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$fn$;

create or replace function auth.role() returns text
language sql stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$fn$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$fn$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
SQL

echo "bootstrap: applying SAFI artifacts migration"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f /migrations/0001_artifacts.sql

echo "bootstrap: applying RLS subject grants"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.artifacts to authenticated;
grant select on public.artifact_versions to authenticated;
grant all on public.artifacts, public.artifact_versions to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
SQL

echo "bootstrap: complete"
