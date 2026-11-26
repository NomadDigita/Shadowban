# Reachframe source comparison

Reviewed against ShadowbanRadar's public homepage, checker, methodology, leaderboard, pricing, and monitoring guide on 2026-11-25. This is a feature and workflow comparison; ShadowbanRadar's private collection and scoring code is not publicly inspectable.

## ShadowbanRadar's public product

- No-login public X account checker with separate checks for account suggestions, post search, reply presence (ghost visibility), and reply placement (deboosting).
- Per-surface outcomes include confidence and an untestable state. Untestable surfaces are excluded from the score; the overall verdict and coverage are separate.
- Dated account reports, evidence, caveats, and action steps. The demo is interactive and explicitly fictional.
- Monitoring plans advertise recurring checks, account history, change alerts, and daily recaps.
- Public product pages include methodology, help/FAQ content, statistics, a live account leaderboard, and mention discovery.

## Reachframe now

| Area | Reachframe implementation | Parity |
| --- | --- | --- |
| Core check | Four guided, user-verified visibility observations; visible, missing, untestable, and unmeasured are distinct. Optional notes preserve query/viewer context, and untestable surfaces can carry a structured reason. | Workflow aligned; no automatic X inspection |
| Results | Measured-only percentage, dated report, action plan, caveats, share link, print/PDF, JSON, and CSV exports. Guided outcomes can include optional self-reported repeat-check and separate-viewer counts, summarized as single observation, repeated, or corroborated. | Strong workflow parity; labels summarize user-entered counts, with no independent provider evidence |
| Workspace | Email/password sign-in, Supabase-backed private history/watchlist, guest browser storage, history comparisons, share privacy handling, and device-only manual recheck reminders. | Core account history parity; reminder prompts do not collect data or run scans |
| Mentions | Search builder for mentions, replies to an account, and posts by an account. Opens the real query on X. | Discovery workflow; no in-app feed or ranking |
| Community | Opt-in aggregate observations and an opt-in alias-based contributor activity board, gated by minimum participation. | First-party aggregate signal, not an X-account leaderboard |
| Education | Four quick guides plus ten FAQ answers covering checks, uncertainty, data, privacy, and next steps. | Disclosed workflow and help coverage expanded; no localized content library yet |
| Design | Original Reachframe visual identity, responsive layout, dark/light themes, and a source-methodology guide. | Source-inspired, not pixel-identical |

The checker records what a person can verify in X. It does not claim to know X's internal moderation state, infer a cause, or independently verify user-entered notes or repeat/viewer counts. Confidence labels are a count-based description: “repeated” means 2+ checks or viewers; “corroborated” means 3+ checks across at least 2 viewers; “partial self-report” means one of the two optional count fields was left blank. They are not probability estimates.

## Remaining gaps to source-level behavior

1. **Provider-backed inspection:** Reachframe has no authorized data provider that can reliably inspect suggestions, search visibility, full conversations, and ranking. Until one is available, automatic results must not be fabricated.
2. **Scheduled monitoring and alerts:** Watchlists save accounts, but do not run background checks or send daily email/Telegram alerts. These need an authorized provider and a delivery service.
3. **Account leaderboard and statistics:** Reachframe has opt-in aggregates, but no verified public X metrics, topic filters, rank history, or large-scale account leaderboard.
4. **In-app mention feed:** The builder opens a real X search. Reachframe does not fetch, store, or rank mention posts.
5. **Educational coverage:** Expand guide, FAQ, statistics, and account-state handling (private/no-post accounts, unavailable replies, and provider-confidence states).
6. **Privacy controls and accessibility:** Continue reviewing consent, export behavior, keyboard access, and small-screen layouts as community and report features expand.

## Parity limit

A true 100% reproduction of ShadowbanRadar's private account data, collection provider, and scoring cannot be verified from the public website. Reachframe can match the disclosed user workflow and continue adding evidence-based features, but only authorized integrations can provide comparable live results.
