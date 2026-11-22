-- Add a stable key for retry-safe imports from a guest browser workspace.
alter table public.reachframe_scans
  add column if not exists client_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reachframe_scans_client_key_format'
      and conrelid = 'public.reachframe_scans'::regclass
  ) then
    alter table public.reachframe_scans
      add constraint reachframe_scans_client_key_format
      check (client_key is null or client_key ~ '^browser:[A-Za-z0-9_-]{1,80}$');
  end if;
end
$$;

create unique index if not exists reachframe_scans_owner_client_key_unique_idx
  on public.reachframe_scans (user_id, client_key);
