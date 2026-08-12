# Product funnel experiment log

Use this dated log to align desktop product changes with GA4 and settled Stripe
outcomes. Treat small samples as directional and compare releases sequentially;
do not infer causality from calendar overlap alone.

## 2026-08-12 — Direct $1 first-value offer

- Status: release target Translator 1.16.8; production verification pending.
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
