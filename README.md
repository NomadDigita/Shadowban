# Reachframe

Reachframe is an independent workspace for checking how a public X account appears to other viewers. It includes guided visibility checks, dated reports, a watchlist, comparison history, change alerts and report exports. The sample report uses fictional data. There is no application paywall.

## Use the hosted app

Enter a public X handle and start a guided check. Follow the links and record the surfaces you can verify from another viewer account. A report shows the share of measured surfaces that were visible, alongside the number of measured surfaces. Reports describe observations that can vary by viewer; X account notices remain the source for official moderation decisions.

Use the Light and Dark controls to set the browser theme. The fictional sample offers three scenarios that do not save data. Saved reports can be filtered by account and compared with the previous report for that account.

Add a handle to the watchlist for quick access. Record another guided check to see measured changes for the same handle. An unmeasured observation does not replace the last measured result in the comparison window.

## Saved data and exports

The hosted app stores its workspace in this browser's local storage on this device. It does not require an account or send saved reports to a server. Clearing browser site data or switching browsers/devices removes access to that local workspace, so download backups you want to keep.

Open a saved report and choose **Download JSON** for a versioned report, or **Print report** and choose **Print / Save PDF**. Choose **Download full history CSV** in Scan history to export saved reports, even those outside the 100 most recent displayed entries. CSV fields that could be interpreted as spreadsheet formulas are prefixed with an apostrophe.

Exports include UTC timestamps, evidence source, measured coverage, individual outcomes and interpretation limits. Fictional samples are excluded. The visibility percentage is blank in CSV and null in JSON when no surfaces were measured.

## Automatic monitoring

Scheduled X API monitoring is disabled in the hosted static version. It requires a server-side X API credential, a durable database and scheduled job infrastructure. No X credentials are stored in this repository or browser. The guided workflow and local history work without provider credentials.

The Python service files in the repository are not used by the Vercel static deployment. They are retained as the prototype backend and must be adapted to durable cloud storage and scheduled execution before being connected to the hosted interface.

## Deploy to Vercel

The repository is configured as a static Vercel site. In the Vercel project settings, use the repository root, select **Other** as the framework, and set the output directory to `static`. No build command, install command or environment variables are required. New commits to the connected branch deploy automatically.

## Limitations

- Reports reflect the views checked at that time. They cannot confirm an X moderation decision or reproduce every viewer’s results.
- The public site does not run automated post-search checks or email alerts.
- Workspace data is limited to this browser and device; there is no cross-device sign-in or cloud backup.

## Public product research

The [ShadowbanRadar homepage](https://shadowbanradar.com/), [methodology](https://shadowbanradar.com/methodology), [public demo](https://shadowbanradar.com/demo), and [monitoring overview](https://shadowbanradar.com/x-shadowban-monitoring) informed the workflow. The public offering shows four distinct visibility signals, an explicit unmeasured state, dated reports and ongoing monitoring. Reachframe implements those workflow concepts with original code, design, copy and a guided workflow that remains usable without provider credentials.

Standard HTTPS requests to all three public pages returned HTTP 200 with TLS verification result 0. The official reverse-engineer-anything skill was retrieved and the REA CLI 6.10.1 was attempted. Chromium's certificate-verified session reported a privacy error (Chromium `ERR_CERT_AUTHORITY_INVALID`, network error `-202`), and REA's passive inspection returned `target_unavailable` with `target_not_allowed`. Research findings come from the verified HTTPS public pages. No login or paid workflow was used.

## Verify

Check the browser script with Node.js:

```bash
node --check static/app.js
```
