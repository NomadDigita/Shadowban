create extension if not exists pgcrypto;

create table if not exists public.reachframe_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_key text check (client_key is null or client_key ~ '^browser:[A-Za-z0-9_-]{1,80}$'),
  handle text not null check (handle = lower(handle) and handle ~ '^[a-z0-9_]{1,15}$'),
  evidence_source text not null default 'guided' check (evidence_source in ('guided')),
  checked_at timestamptz not null default now(),
  results jsonb not null check (
    jsonb_typeof(results) = 'object' and
    results ? 'suggestions' and results ? 'search' and
    results ? 'thread' and results ? 'placement' and
    coalesce(results->'suggestions'->>'status', '') in ('visible','missing','unknown') and
    coalesce(results->'search'->>'status', '') in ('visible','missing','unknown') and
    coalesce(results->'thread'->>'status', '') in ('visible','missing','unknown') and
    coalesce(results->'placement'->>'status', '') in ('visible','missing','unknown')
  )
);

create index if not exists reachframe_scans_owner_handle_checked_idx
  on public.reachframe_scans (user_id, handle, checked_at desc);

create unique index if not exists reachframe_scans_owner_client_key_unique_idx
  on public.reachframe_scans (user_id, client_key);

create table if not exists public.reachframe_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text not null check (handle = lower(handle) and handle ~ '^[a-z0-9_]{1,15}$'),
  created_at timestamptz not null default now(),
  unique (user_id, handle)
);

alter table public.reachframe_scans enable row level security;
alter table public.reachframe_watchlist enable row level security;

create policy "Users can read their Reachframe scans"
  on public.reachframe_scans for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can add their Reachframe scans"
  on public.reachframe_scans for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their Reachframe scans"
  on public.reachframe_scans for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Reachframe watchlist"
  on public.reachframe_watchlist for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can add to their Reachframe watchlist"
  on public.reachframe_watchlist for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can remove from their Reachframe watchlist"
  on public.reachframe_watchlist for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on public.reachframe_scans to authenticated;
grant select, insert, delete on public.reachframe_watchlist to authenticated;
