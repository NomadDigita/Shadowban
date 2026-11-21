# Reachframe source comparison

Reviewed in a browser on 2026-11-21: the Shadowban Radar homepage, methodology, public demo, pricing, and monitoring guide.

## Product behavior seen in the source

- Public, no-login X account check with four separate signals: search suggestions, post search, reply presence (ghost ban), and reply placement (deboosting).
- Each signal has its own verdict and confidence. A result can be untestable; those checks are excluded from the score. Private/no-post accounts and accounts with no recent replies have explicit states.
- The overall verdict, measurement coverage, and score are separate. No measured checks produces no score, rather than zero.
- A detailed dated report with evidence, limits, an action plan, and account-level information.
- The demo is explicitly fictional and interactive.
- Optional paid plans provide multi-account recurring checks, change alerts, history/trends, and daily recaps. The service says it only uses public X output and does not have an internal X moderation flag or cause.
- Public guide pages, methodology, FAQs, statistics, and leaderboard support the core checker.

## Reachframe today

- The four check categories, an illustrative report, guided observation, unmeasured state, measured-only visibility percentage, history, watchlist, change comparisons, JSON/CSV/print exports, and light/dark themes are implemented.
- Observations are user-recorded; Reachframe does not independently query X. They are saved to local storage on one browser/device.
- There is no login, durable database, background monitoring, email/Telegram notifications, public live leaderboard, source-equivalent account score, or automated action plan.
- The current experience is therefore a transparent manual visibility workspace, not a functional copy of the source's data collection service.

## Architecture being prepared

The Supabase migration in this branch creates user-owned scan history and watchlists with row-level security. It intentionally contains no provider credentials and no public anonymous write policy. The frontend should use only a Supabase publishable key; privileged database and provider secrets must stay server-side.

## Remaining work for functional parity

1. Create an isolated Reachframe Supabase project, apply the migration, enable and configure sign-in email delivery, and connect the public URL/key to Vercel.
2. Implement account sign-in, session state, and sync of scans/watchlists to per-user rows while retaining a clear no-login free check.
3. Add a real public-data inspection provider behind a server endpoint. No fake automated outcomes: searches and thread checks must distinguish pass, fail, and untestable with evidence and confidence.
4. Add scheduled rechecks and deduplicated alerts only after an authorized provider and email/Telegram delivery configuration are available.
5. Build the action plan, score trend, optional multi-account plans, language/accessibility coverage, educational guide content, and source-inspired directory pages with original branding and copy.

The source's internal provider and scoring implementation are not public. Reachframe can reproduce its observable workflow and disclosed methodology, but matching its internal data source or hidden decisions cannot be verified from public pages.
