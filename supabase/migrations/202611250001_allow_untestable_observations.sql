alter table public.reachframe_scans
  drop constraint if exists reachframe_scans_results_check;

alter table public.reachframe_scans
  add constraint reachframe_scans_results_check check (
    jsonb_typeof(results) = 'object' and
    results ? 'suggestions' and results ? 'search' and
    results ? 'thread' and results ? 'placement' and
    coalesce(results->'suggestions'->>'status', '') in ('visible','missing','untestable','unknown') and
    coalesce(results->'search'->>'status', '') in ('visible','missing','untestable','unknown') and
    coalesce(results->'thread'->>'status', '') in ('visible','missing','untestable','unknown') and
    coalesce(results->'placement'->>'status', '') in ('visible','missing','untestable','unknown')
  );
