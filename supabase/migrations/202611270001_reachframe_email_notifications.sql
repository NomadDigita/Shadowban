create table if not exists public.reachframe_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_observation_changes boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.reachframe_notification_preferences enable row level security;

create policy "Users can read their Reachframe notification preferences"
  on public.reachframe_notification_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their Reachframe notification preferences"
  on public.reachframe_notification_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their Reachframe notification preferences"
  on public.reachframe_notification_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.reachframe_notification_preferences to authenticated;

create table if not exists public.reachframe_notification_deliveries (
  scan_id uuid primary key references public.reachframe_scans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.reachframe_notification_deliveries enable row level security;
revoke all on public.reachframe_notification_deliveries from anon, authenticated;
