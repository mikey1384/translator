# MCP Unlock — Subscription-Powered Translator (Idea)

_Captured 2026-07-19 from a brainstorm. Not scheduled; revisit when ready._

## The problem this solves

Power users already pay $100–200/mo for Claude Max or ChatGPT Pro. They do
not want a second subscription or per-use AI credits on top. Today their
only options are Stage5 credits or BYO API keys — both cost extra money per
use. Result: churn objection from exactly the most AI-native customers.

## The idea

Expose the translator as an **MCP server** (Model Context Protocol — the
open standard that lets AI clients like Claude Desktop, Claude Code, and
ChatGPT connect to external tool servers). Gate it behind the existing
Stripe unlock, which becomes a combined "API + MCP unlock" (Power unlock):
one-time purchase, then the user's own AI subscription does the heavy
lifting.

## Two distinct versions (build both, but B is the money feature)

### Version A — agents drive the app (orchestration)

Tools like `download_video`, `transcribe`, `translate_srt`, `dub`,
`search_videos`, `cut_highlights`, `list_library`. The user's agent
orchestrates whole workflows ("grab this playlist, transcribe everything,
translate to Korean").

- Very feasible: main-process services already have clean seams with
  operationId-scoped concurrency (hardened during the tabs work), so tool
  calls are thin wrappers.
- **Does NOT save the user money by itself** — the agent's subscription
  covers the agent's reasoning, not the app's internal API calls.
  Transcription/translation inside the pipeline would still burn
  credits/BYO keys.

### Version B — the subscription becomes the inference engine

Invert the translation pipeline so the external model does the inference:

1. `get_untranslated_batch` → returns ~10 lines + context
2. The user's Claude/ChatGPT translates them in its own turn
   (**paid by their flat subscription — zero marginal API cost**)
3. `submit_translated_batch` → writes results back
4. Repeat until done (same loop works for the review pass)

- Works with ANY MCP client — no exotic protocol features required.
- MCP has a purpose-built mechanism for this ("sampling":
  `sampling/createMessage`, where the server asks the client to run a
  completion directly). Cleaner when available, but client support was
  patchy as of early 2026 — the batch round-trip is the robust design;
  treat sampling as a progressive enhancement.
- Slower than the native pipeline (bounded by the agent's turn loop), but
  "slow and free" is exactly the trade this user wants.

## The honest caveat — one leg can't ride a chat subscription

Whisper transcription (audio→text) and ElevenLabs dubbing have no
subscription-powered path — chat subscriptions can't do audio-in.
Options:

- Keep transcription/dubbing on credits/BYO (translation-only via MCP), or
- **Bundle local whisper.cpp** so transcription becomes free-and-local too.
  At that point a Max subscriber pays the one-time unlock and never pays
  per-use again. Bigger lift; consider as phase 2.

## Gating & business model

- The existing Stripe BYO unlock + entitlements system is exactly the right
  gate — MCP server refuses tool calls without the entitlement.
- Rebrand "API unlock" → "Power unlock" (BYO keys + MCP access).
- Coherent economics: one-time fee for self-serve compute paths; Stage5
  credits remain the zero-setup convenience path. Converts the "no second
  subscription" objection into a purchase instead of churn.

## Technical sketch

- **Transport:** localhost HTTP (streamable) MCP server in the main process
  with a generated auth token the user pastes into their client config.
  Optionally a tiny stdio proxy binary for clients that prefer stdio.
- **Security (not skippable):** token auth per call, entitlement check per
  call, strict path discipline on any tool that reads/writes disk.
- **UI tie-in:** operations started via MCP surface as a tab with the
  existing progress ring/badge infra — the user watches their agent work.
  (Great demo.)
- **Stepping stone below MCP:** a headless CLI mode
  (`translator-cli transcribe …`) that Claude Code can drive today with
  zero protocol work. MCP is what unlocks Claude Desktop / ChatGPT users —
  where most $200/mo subscribers live.

## Effort estimate (from initial assessment)

- MVP (localhost server, token auth, entitlement gate, 4–5 tools wrapping
  existing services, ops visible in a tab): **days, not weeks**.
- The batch round-trip translation mode is the one piece of genuinely novel
  design work.
- Phase 2: local whisper.cpp bundling; sampling support as clients mature.

## Open questions for later

- Pricing: same unlock SKU or a new tier?
- Rate limits / abuse: does the entitlement need per-device binding for MCP?
- Which clients to target first (Claude Code is easiest to test; Claude
  Desktop reaches the most Max subscribers)?
- Does the review pass stay optional in subscription mode (it doubles the
  round-trips)?
