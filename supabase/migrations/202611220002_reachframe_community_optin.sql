-- Opt-in Reachframe community benchmarks. Only pseudonymous contributor counts and
-- aggregated guided observations are public; account handles and scan rows stay private.
create table if not exists public.reachframe_community_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_observations boolean not null default false,
  show_on_leaderboard boolean not null default false,
  public_alias text,
  updated_at timestamptz not null default now(),
  constraint reachframe_community_alias_format check (
    public_alias is null or (length(public_alias) between 2 and 32 and public_alias !~ '[<>]')
  ),
  constraint reachframe_community_leaderboard_requires_share check (
    show_on_leaderboard = false or share_observations = true
  )
);

create index if not exists reachframe_community_members_sharing_idx
  on public.reachframe_community_members (share_observations, show_on_leaderboard);

alter table public.reachframe_community_members enable row level security;

create policy "Users can read their Reachframe community settings"
  on public.reachframe_community_members for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their Reachframe community settings"
  on public.reachframe_community_members for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their Reachframe community settings"
  on public.reachframe_community_members for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their Reachframe community settings"
  on public.reachframe_community_members for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.reachframe_community_members to authenticated;

create or replace function public.reachframe_community_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  contributor_count integer;
  report_count integer;
  surface_totals jsonb;
  contributor_board jsonb;
begin
  select count(distinct s.user_id), count(*)
    into contributor_count, report_count
  from public.reachframe_scans s
  join public.reachframe_community_members m on m.user_id = s.user_id
  where m.share_observations
    and s.checked_at >= now() - interval '30 days'
    and s.evidence_source = 'guided';

  -- Suppress aggregates until at least five opted-in accounts have contributed.
  if contributor_count < 5 then
    return jsonb_build_object(
      'ready', false,
      'minimum_contributors', 5,
      'contributors', contributor_count,
      'reports', report_count,
      'window_days', 30
    );
  end if;

  select coalesce(jsonb_object_agg(summary.surface, jsonb_build_object(
    'visible', summary.visible_count,
    'missing', summary.missing_count,
    'measured', summary.measured_count
  )), '{}'::jsonb)
    into surface_totals
  from (
    select field.surface,
      count(*) filter (where field.observation->>'status' = 'visible') as visible_count,
      count(*) filter (where field.observation->>'status' = 'missing') as missing_count,
      count(*) filter (where field.observation->>'status' in ('visible','missing')) as measured_count
    from public.reachframe_scans s
    join public.reachframe_community_members m on m.user_id = s.user_id
    cross join lateral jsonb_each(s.results) as field(surface, observation)
    where m.share_observations
      and s.checked_at >= now() - interval '30 days'
      and s.evidence_source = 'guided'
    group by field.surface
  ) as summary;

  select coalesce(jsonb_agg(to_jsonb(board)), '[]'::jsonb)
    into contributor_board
  from (
    select m.public_alias as alias, count(*)::integer as reports
    from public.reachframe_scans s
    join public.reachframe_community_members m on m.user_id = s.user_id
    where m.share_observations
      and m.show_on_leaderboard
      and m.public_alias is not null
      and s.checked_at >= now() - interval '30 days'
      and s.evidence_source = 'guided'
    group by m.user_id, m.public_alias
    order by reports desc, alias asc
    limit 10
  ) as board;

  return jsonb_build_object(
    'ready', true,
    'contributors', contributor_count,
    'reports', report_count,
    'window_days', 30,
    'surfaces', surface_totals,
    'leaderboard', contributor_board
  );
end;
$$;

revoke all on function public.reachframe_community_snapshot() from public;
grant execute on function public.reachframe_community_snapshot() to anon, authenticated;
