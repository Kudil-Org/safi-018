-- SAFI Platform v0.1 - Artifact state, immutable versioning, owner-only RLS
-- Safi Service SOW 018. Proprietary and Copyright 2026 B. Gopinath.
--
-- Apply with: psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_artifacts.sql
-- or:          supabase db push
--
-- Design rules
--   1. An Artifact is owned by exactly one auth.users row.
--   2. Every successful mutation increments the integer version by one and
--      appends an immutable snapshot to artifact_versions.
--   3. Direct clients may read only their own rows. Writes from the SPA go through
--      the trusted API, never through direct table access.
--   4. The trusted API uses service_role and passes p_actor; RLS itself still
--      denies cross-user reads/updates for anon/authenticated callers.

begin;

create table if not exists public.artifacts (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  template_ref      text not null default 'checklist.v1',
  state             jsonb not null,
  version           integer not null default 1 check (version >= 1),
  booking_id        text,
  booking_start_at  timestamptz,
  booking_timezone  text,
  event_type_slug   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint artifacts_state_is_object check (jsonb_typeof(state) = 'object'),
  constraint artifacts_template_ref_present check (length(template_ref) between 1 and 120)
);

create unique index if not exists artifacts_booking_id_key
  on public.artifacts (booking_id)
  where booking_id is not null;

create index if not exists artifacts_owner_updated_idx
  on public.artifacts (owner_id, updated_at desc);

create table if not exists public.artifact_versions (
  id           bigint generated always as identity primary key,
  artifact_id  uuid not null references public.artifacts (id) on delete cascade,
  version      integer not null check (version >= 1),
  state        jsonb not null,
  mutation     jsonb not null default '{}'::jsonb,
  created_by   uuid not null references auth.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint artifact_versions_state_is_object check (jsonb_typeof(state) = 'object'),
  constraint artifact_versions_unique_version unique (artifact_id, version)
);

create index if not exists artifact_versions_artifact_version_idx
  on public.artifact_versions (artifact_id, version desc);

alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;

-- Owner-only reads.
drop policy if exists artifacts_select_owner on public.artifacts;
create policy artifacts_select_owner
  on public.artifacts
  for select
  to authenticated
  using (auth.uid() = owner_id);

-- Owner-only inserts. The SPA does not use this path (it calls the trusted API),
-- but the policy keeps the table owner-scoped for any future direct client.
drop policy if exists artifacts_insert_owner on public.artifacts;
create policy artifacts_insert_owner
  on public.artifacts
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

-- Owner-only updates. Cross-user updates are denied by USING and WITH CHECK.
drop policy if exists artifacts_update_owner on public.artifacts;
create policy artifacts_update_owner
  on public.artifacts
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Version history is readable only by the Artifact owner. There are deliberately
-- no INSERT/UPDATE/DELETE policies: history is append-only through the RPC below.
drop policy if exists artifact_versions_select_owner on public.artifact_versions;
create policy artifact_versions_select_owner
  on public.artifact_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.artifacts a
      where a.id = artifact_versions.artifact_id
        and a.owner_id = auth.uid()
    )
  );

-- Defense in depth: even a table owner session cannot rewrite history.
revoke update, delete on public.artifact_versions from anon, authenticated;
revoke insert, update, delete on public.artifacts from anon;

-- Single authorized mutation boundary. The trusted API computes the next full
-- state, then calls this RPC with the expected version. The update predicate makes
-- the version check atomic; a stale write raises 40001 and never inserts history.
create or replace function public.safi_mutate_artifact(
  p_artifact_id     uuid,
  p_expected_version integer,
  p_state           jsonb,
  p_mutation        jsonb default '{}'::jsonb,
  p_actor           uuid default null
)
returns public.artifacts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_row   public.artifacts;
begin
  if auth.role() = 'service_role' then
    v_actor := p_actor;
  else
    v_actor := auth.uid();
  end if;

  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'invalid_expected_version' using errcode = '22023';
  end if;

  update public.artifacts
     set state = p_state,
         version = version + 1,
         booking_id = case
           when p_state ? 'booking' and p_state->'booking' ? 'id'
             then nullif(p_state->'booking'->>'id', '')
           else null
         end,
         booking_start_at = case
           when p_state ? 'booking' and p_state->'booking' ? 'startAt'
             then nullif(p_state->'booking'->>'startAt', '')::timestamptz
           else null
         end,
         booking_timezone = case
           when p_state ? 'booking' and p_state->'booking' ? 'timezone'
             then nullif(p_state->'booking'->>'timezone', '')
           else null
         end,
         event_type_slug = case
           when p_state ? 'booking' and p_state->'booking' ? 'eventTypeSlug'
             then nullif(p_state->'booking'->>'eventTypeSlug', '')
           else null
         end,
         updated_at = now()
   where id = p_artifact_id
     and owner_id = v_actor
     and version = p_expected_version
  returning * into v_row;

  if not found then
    if exists (
      select 1 from public.artifacts
      where id = p_artifact_id and owner_id = v_actor
    ) then
      raise exception 'version_conflict' using errcode = '40001';
    else
      raise exception 'not_found_or_forbidden' using errcode = '42501';
    end if;
  end if;

  insert into public.artifact_versions (artifact_id, version, state, mutation, created_by)
  values (v_row.id, v_row.version, v_row.state, coalesce(p_mutation, '{}'::jsonb), v_actor);

  return v_row;
end;
$$;

revoke all on function public.safi_mutate_artifact(uuid, integer, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.safi_mutate_artifact(uuid, integer, jsonb, jsonb, uuid) to authenticated, service_role;

comment on table public.artifacts is 'SOW 018 checklist Artifacts. Owner-only RLS. Writes via safi_mutate_artifact.';
comment on table public.artifact_versions is 'Immutable append-only Artifact history. Readable only by the Artifact owner.';
comment on function public.safi_mutate_artifact(uuid, integer, jsonb, jsonb, uuid) is 'Atomic owner-scoped mutation with optimistic version check and immutable snapshot.';

commit;
