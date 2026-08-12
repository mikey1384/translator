# Product funnel experiment log

Use this dated log to align desktop product changes with GA4 and settled Stripe
outcomes. Treat small samples as directional and compare releases sequentially;
do not infer causality from calendar overlap alone.

## 2026-08-12 — YouTube download recovery baseline

- Status: prepared for Translator 1.16.10; production release evidence will be
  recorded here after the backend contract and signed app artifacts ship.
- Problem: a valid YouTube URL can reach a rate limit, login requirement, or
  human-verification step before the customer experiences Translator. The
  existing app opened an isolated local connection window and retried after the
  user closed it, but the flow was unmeasured and the manual close was easy to
  miss after a first-time sign-in.
- Change: when a customer signs into YouTube for the first time in Translator's
  isolated connection session, automatically close the connection window only
  after valid YouTube authentication cookies exist and navigation has returned
  to YouTube; then use the existing automatic retry. Previously authenticated,
  stale sessions and non-login verification retain the explicit-close fallback.
- Measurement: record URL download starts, yt-dlp completions, cancellations,
  cookie requirements, coarse failures, and connection-window outcomes. Segment
  only by `youtube|other`, the allowlisted verification cause, coarse failure
  category, release/OS/architecture/locale, and whether connection began from
  download recovery or Settings.
- Privacy contract: never collect the URL, hostname, video or channel identity,
  title, cookie value or count, account data, file path, raw yt-dlp output, or
  error content. The API strict schema rejects unapproved fields and classified
  internal devices remain excluded before the analytics outbox.
- Primary read: YouTube yt-dlp completion per start; connection start per cookie
  requirement; connection completion per connection start; and successful
  automatic retry inferred from the next YouTube completion. Continue to read
  `app_meaningful_use(video_download)` separately because yt-dlp completion is
  not proof that the customer accepted and used the downloaded file.
- Guardrails: no browser-cookie extraction, no CAPTCHA bypass, no change to
  download-site access controls, no production synthetic traffic, and no claim
  of improved conversion until real released-app cohorts accumulate.

## 2026-08-12 — Critical startup and process health baseline

- Status: shipped for macOS in Translator 1.16.9 on 2026-08-12 at 14:31
  Asia/Bangkok from source commit `0b35208` and release workflow `31572908903`.
  Native-architecture, signature, notarization, updater archive, GitHub asset,
  R2 feed, and exact latest-artifact checks passed. The production contract was
  deployed first as Stage5 API Worker `c567cbf8-fa29-4fd2-9f43-48548a48200b`;
  Homebrew cask commit `7def90d` and validation run `31574542740` are current.
  Windows remains in the pre-change cohort until the separately signed 1.16.9
  build is completed and verified.
- Problem: download clicks without a later `app_open` can indicate abandonment,
  installer friction, an app that never launched, or a failure before the old
  analytics code initialized. The prior measurement could not distinguish those
  causes or measure later renderer and child-process terminations.
- Change: install a packaged-app-only startup sentinel before the bundled main
  process loads. It persists an interrupted startup locally and reports it after
  the next successful authenticated launch. Runtime main-process, renderer, and
  child-process failures use the same durable queue.
- Privacy contract: `app_critical_failure` contains only an allowlisted failure
  class, startup phase, failed app version, OS, architecture, and—only for a
  renderer or child process—an allowlisted termination reason. The client stores
  and the API accepts no error message, stack trace, path, filename, URL, media
  metadata, subtitle text, customer content, or raw device identity. Classified
  internal devices remain excluded server-side.
- Reliability controls: a normal second-instance exit is explicitly successful;
  normal shutdown process exits are ignored; malformed persisted records are
  discarded; events are acknowledged locally only after the authenticated API
  accepts them; the API and GA4 outbox deduplicate by event ID.
- Primary read: critical failures per released-app `app_open`, segmented by
  failed version, OS/architecture, failure class, startup phase, and process
  reason. Preserve download-to-`app_open` by architecture as the broader control
  because a device that never launches again cannot upload its sentinel.
- Guardrails: telemetry must never delay or prevent startup, synthetic crashes
  are not generated in production, and low-count diagnostics must not be treated
  as customer-demand evidence.

## 2026-08-12 — Direct $1 first-value offer

- Status: macOS Translator 1.16.8 shipped on 2026-08-12 at 13:38
  Asia/Bangkok from source commit `2475dab` and release workflow `31569954652`.
  The production analytics contract was deployed first as Stage5 API Worker
  `b425de8d-3913-4376-9691-c874fe963e1c`. The separately signed Windows 1.16.8
  build is not yet live, so Windows traffic remains in the pre-change cohort
  until its owner-operated release is verified.
- Baseline window: 2026-08-05 through 2026-08-11 (Asia/Bangkok).
- Aggregate GA4 evidence: about 14 downloaders, 8 app devices opened, 3 devices
  reached the current video-open or video-download meaningful-use milestone, 1
  `begin_checkout`, and 1 settled `purchase` worth US$1.
- Aggregate Stripe evidence: two non-zero US$1 Checkout Sessions; one paid and
  one expired. A separate zero-total expired session is excluded from the
  purchase-conversion denominator.
- Measurement limit: the current meaningful-use event does not measure a
  successful transcription or translation, so true first-translation activation
  is unknown and no higher than the three observed meaningful-use devices.
- Hypothesis: a zero-credit user currently sees a purchase warning but must
  navigate to Settings and choose among four packs before checkout. Offering the
  existing MICRO pack directly at the zero-credit banner and credit-exhausted
  dialog will reduce pre-checkout friction without changing price, entitlements,
  refund handling, or requiring automatic spend.
- Change: add a localized, quantified `US$1 · 0.8 translation hrs` secure-checkout
  action at both zero-credit blocks; retain Settings for every pack and BYO
  provider configuration.
- Primary read: `begin_checkout` per eligible released-app device, followed by
  settled `purchase` per `begin_checkout` and MICRO Checkout paid/expired counts.
- Guardrails: no automatic checkout, no synthetic traffic, no pricing change,
  no loss of Settings or BYO access, and no regression in checkout reconciliation.
- Measurement repair prepared with the app change: emit privacy-safe
  `translation_started`, `translation_completed`, `translation_credit_blocked`,
  `translation_cancelled`, and `translation_failed` events for full-SRT
  workflows. Events contain app/runtime dimensions and an allowlisted workflow,
  but no media URL, filename, subtitle text, target language, customer identity,
  or device ID in GA4. The API continues to pseudonymize devices and excludes
  classified internal devices before its analytics outbox.
