# Reachframe

Reachframe is an independent workspace for checking how a public X account appears to other viewers. It includes a guided visibility audit, dated reports, a private browser workspace, a watchlist, and in-app changes. The sample report uses fictional data. There is no application paywall.

## Run locally

Requires Python 3.11 or newer with SQLite support. The app uses only the Python standard library.

Extract `Reachframe.zip` and run this command from the extracted `Reachframe` directory:

```bash
python3 app.py
```

Open http://127.0.0.1:8000. Enter an X handle and start a guided check. Follow the links and record the surfaces you can verify. A report shows the share of measured surfaces that were visible alongside the number of measured surfaces. Reports show observations, which can vary by viewer. X account notices are the source for official moderation decisions.

Add a handle to the watchlist for quick access. When you record a changed result for the same handle and evidence source, it appears under Change alerts. An unmeasured observation does not replace the last measured result in the recent comparison window.

## Optional X API monitoring

Enable scheduled monitoring with an X developer app bearer token and an explicit daily scan budget. The app uses X User Lookup, User Posts and Recent Search. The token needs access to these endpoints. The operator is responsible for X API charges.

```bash
export X_BEARER_TOKEN='your-app-bearer-token'
export DAILY_SCAN_BUDGET=5
python3 app.py
```

The budget is global to the SQLite database and counts scan attempts per UTC day. Each attempt makes up to three X API requests. A handle is eligible for a scan at most once a day by default. The app must be running for scheduled scans. Watches beyond the daily budget wait until capacity is available. A positive budget enables automatic scans for all workspaces on that instance, so set a budget you can cover if you share the instance.

Automatic checks compare recent original post IDs on the account timeline with X Recent Search. Only the post-search signal is populated by this integration. Account suggestions, reply presence, and reply placement use the guided workflow. A missing post is evidence about the sampled X API response. Viewer-specific rankings and X's internal labels are outside that measurement. API failures, protected profiles, missing sample posts and incomplete search responses produce unmeasured results. The live integration requires credentials and was tested with controlled provider responses.

## Configuration and data

- `HOST` and `PORT` set the HTTP listener, defaulting to `127.0.0.1:8000`.
- `REACHFRAME_DB` sets the SQLite database path. Preserve the database and the browser cookie to keep access to the same workspace.
- `SCAN_INTERVAL_SECONDS` sets the minimum time between scheduled checks, with a floor of 86,400 seconds.
- `SECURE_COOKIE=1` enables secure cookies when serving behind HTTPS.

The default `reachframe.sqlite3` database is created on first startup alongside `app.py`. The database stores anonymous workspace IDs, handles, scans, watch schedules, daily scan counts and changes. Workspaces are isolated by an opaque HTTP-only cookie. The application defaults to local use.

## Limitations

- The report reflects the views you tested. It cannot confirm X moderation decisions or reproduce every viewer’s results.
- Scheduled monitoring covers post search only. The other three checks require manual observations.
- Alerts appear inside the workspace. The app has no email delivery or cross-device sign-in.

## Public product research

The [ShadowbanRadar homepage](https://shadowbanradar.com/), [methodology](https://shadowbanradar.com/methodology), and [public demo](https://shadowbanradar.com/demo) informed the workflow. The public offering shows four distinct visibility signals, an explicit unmeasured state, dated reports and ongoing monitoring. Reachframe implements those workflow concepts with original code, design, copy and a guided workflow that remains usable without provider credentials.

Standard HTTPS requests to all three public pages returned HTTP 200 with TLS verification result 0. The official reverse-engineer-anything skill was retrieved and the REA CLI 6.10.1 was attempted. Chromium's certificate-verified session reported a privacy error (Chromium `ERR_CERT_AUTHORITY_INVALID`, network error `-202`), and REA's passive inspection returned `target_unavailable` with `target_not_allowed`. Research findings come from the verified HTTPS public pages. No login or paid workflow was used.

## Verify

Use Python for the backend tests and Node.js for the optional JavaScript syntax check.

```bash
python3 -m unittest -v
node --check static/app.js
```
