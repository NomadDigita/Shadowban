# Reachframe

Reachframe is an independent workspace for checking how a public X account appears to other viewers. It includes guided visibility checks, dated reports, a watchlist, comparison history, change alerts and report exports. The sample report uses fictional data. There is no application paywall.

## Use the hosted app

Enter a public X handle and start a guided check. Follow the links and record the surfaces you can verify from another viewer account. A report shows the share of measured surfaces that were visible, alongside the number of measured surfaces. Reports describe observations that can vary by viewer; X account notices remain the source for official moderation decisions.

Choose Light or Dark to set the browser theme. The fictional sample offers scenarios that do not save data. Saved reports can be filtered by account and compared with earlier observations.

Add a handle to the watchlist for quick access. Record another guided check to see measured changes for the same handle. Unmeasured observations do not replace the last measured result in comparisons.

## Accounts and saved data

Guests keep reports and watchlists in this browser on this device. Sign in or create an account to sync them to Supabase across devices. On first sign-in, Reachframe imports the current browser’s saved guided reports and watchlist into that account. Sign out returns to the local guest workspace; it does not delete cloud data.

The browser uses a Supabase publishable key in `static/config.js`. Publishable keys are designed for client applications; row-level security restricts each account’s reads and writes to rows that carry its authenticated user ID. Never put a Supabase secret or service-role key in this repository.

Email confirmation behavior follows the Supabase Auth project settings. For production signup, configure the project’s Site URL and allowed redirect URLs for the deployed Reachframe origin. Public email delivery may also require a custom SMTP provider.

## Reports and exports

Open a saved report and choose Download JSON or Print report. Choose Download full history CSV in Scan history to export saved reports. CSV fields that could be interpreted as spreadsheet formulas are prefixed with an apostrophe.

Exports include UTC timestamps, evidence source, measured coverage, individual outcomes and interpretation limits. Fictional samples are excluded. Visibility percentage is null or blank when no surfaces were measured.

## Community data and alerts

The community pulse is built only from signed-in members who explicitly opt in. It aggregates guided observations over 30 days, hides the sample until at least five contributors participate, and never publishes tracked X handles. The optional contributor board shows a pseudonym and report count only. Members can turn sharing off in the workspace. Browser alerts are delivered only while the Reachframe tab is open.

The watchlist links to X's own live search for public mentions. Reachframe does not scrape X pages or claim to reproduce a complete mentions timeline.

## X API access

Automated API checks are intentionally not enabled. X's current Developer Policy says not to use the API to measure or analyze spam/security on X, and prohibits products that do this without X's express written permission. The Developer Agreement also says use of X API content for a service must be explicitly approved. A Reachframe API integration would therefore require written approval from X for the exact visibility-check and monitoring use case before it can be activated. X's pay-per-use page currently lists $0.005 per post read and $0.010 per user read. No X API token or paid credits are configured here.

Sources: [X Developer Policy](https://docs.x.com/developer-terms/policy) · [X Developer Agreement](https://docs.x.com/developer-terms/agreement) · [X API pricing](https://developer.x.com/).

The Python service files are a retained prototype backend and are not used by the static Vercel deployment.

## Deploy to Vercel

The repository is configured as a static Vercel site with output directory `static`. No build or install command is required. New commits to the connected branch deploy automatically.

## Limitations

- Reports reflect the views checked at that time. They cannot confirm an X moderation decision or reproduce every viewer’s results.
- The public site does not run automated post-search checks or email alerts.
- Guest workspace data is limited to this browser and device; sign in for cloud sync.

## Public product research

The ShadowbanRadar homepage, methodology, public demo and monitoring overview informed the workflow. Reachframe implements those workflow concepts with original code, design, copy and a guided workflow that remains usable without provider credentials.

## Verify

Check the browser script with Node.js:

```bash
node --check static/app.js
```
