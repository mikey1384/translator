# Translator agent interface

Translator exposes a local stdio MCP server for two related jobs:

1. Let an LLM subscription translate or review subtitles without a separate
   per-line Translator API charge.
2. Let developers dogfood the desktop app through typed controls instead of
   brittle coordinate clicks.

The server is local. It does not listen on a network port and it does not send
files to Stage5 by itself.

## What is free in this path

The connected LLM supplies translation and review text from its existing chat
or coding-agent subscription. Translator performs local SRT parsing, session
storage, validation, and export. This avoids a second marginal model charge for
translation and review.

It does not make audio transcription, hosted translation, or dubbing free.
Those app-processing tools use the same configured Stage5 credits or BYO
provider billing as the visible UI. The no-extra-inference path applies only to
the local translation-session loop where the connected client supplies text.

## Persistent MCP v2 workflow

MCP v2 keeps the original direct app tools for compatibility and adds a
recoverable, plan-first workflow. Its tools are:

- Discovery and planning: `get_server_info`, `get_capabilities`, `doctor`,
  `probe_source`, and `plan_job`
- Durable jobs: `create_job`, `get_job`, `list_jobs`, `watch_job`, `pause_job`,
  `resume_job`, `cancel_job`, and `retry_stage`
- External translation: `get_transcript_batch`,
  `submit_translation_batch`, `validate_translation`, `get_project_profile`,
  and `save_project_profile`
- Outputs: `render_preview`, `render_outputs`, `verify_outputs`, and
  `get_job_manifest`
- Human-gated publishing handoff: `prepare_youtube_upload` and `prepare_x_post`

The older direct app tools remain available for compatibility. Any legacy tool
that can start paid inference is explicitly labeled as low-level in `tools/list`:
it does not inherit v2 planning, durable recovery, or idempotency guarantees and
must not be blindly retried after an uncertain delivery. New workflows should
use `plan_job` and `create_job` whenever the operation is supported there.

Every result envelope repeats:

- `environment` (`development` or `production`) and a visibly different server
  name
- MCP protocol/server version and connected Translator version
- Masked Stage5 account identity and the current credit snapshot, including
  explicit `connection_verified` and credit `authoritative` flags
- Per-call billing intent, including whether the call may or will consume
  Stage5 credit

`plan_job` is no-cost. It probes the exact source, snapshots the selected
providers, quality settings, credit rates, project profile, expected outputs,
platform constraints, time/disk ranges, and a per-stage Stage5 credit estimate.
It returns an immutable `plan_hash`. `create_job` requires an `idempotency_key`;
repeating the same request returns the existing job instead of starting or
charging twice. A paid plan also requires
`confirm=AUTHORIZE_STAGE5_CREDITS` and a `max_stage5_credits` value at least as
large as the estimate.

Source URLs must use HTTP or HTTPS and cannot contain embedded username/password
credentials. Use Translator's normal cookie or sign-in flow for authenticated
media; those credentials are never copied into a persistent plan or result.

That maximum is a preflight estimate gate, not a provider-side hard cap.
Provider settlement is authoritative and can differ after a request has begun.
Before each paid stage, the helper and renderer independently recheck the exact
provider route, relevant quality/rate assumptions, current authoritative
balance, persisted authorization, cancellation state, and operation identity.
The job records observed usage per operation without treating unrelated
account-wide balance changes as exact job spend.

Jobs use transactional SQLite storage under
`~/.translator-agent/v2/{production,development}.sqlite3`. State includes the
immutable plan, stages, generation-fenced operation IDs, event cursor, credit
ledger, translation batches, validation, artifacts, and audit history. Jobs
survive helper disconnects, agent context resets, and app restarts. If an app
restart or lost acknowledgement makes delivery unknowable, the job blocks at
the last safe checkpoint and requires an explicit stage retry; it never guesses
that a paid request was not delivered.

Each helper that claims a starting stage owns a private random local socket or
named pipe and an exact token. Other helpers probe that lease before deciding a
start was abandoned. The descriptor is stored only for recovery, the token and
pending manifest internals are removed recursively from all public results, and
shutdown closes the lease before the job database. This is ownership detection,
not a timer or keyword heuristic.

`resume_job` is deliberately narrow: it resumes only a job that was explicitly
paused. A blocked, failed, interrupted, or delivery-unknown checkpoint requires
`retry_stage`, so an ordinary resume cannot replay a request that may already
have reached a paid inference provider. Once an app stage starts it can continue
without the MCP client; a later `get_job` or `watch_job` reconciles its retained
result and may advance the next stage already authorized by that persisted job.
The response repeats the remaining authorized credit estimate; observing a job
never grants new paid-stage authorization. If the app also restarts and an
inference result is no longer observable, the job stays blocked for explicit
review.

Retrying a paid stage also requires
`confirm_paid_retry=RETRY_PAID_STAGE`. This is separate from the original plan
authorization because an earlier delivery-unknown or failed attempt may already
have settled provider usage; an agent cannot silently turn an ordinary retry
into duplicate spend.

### External-agent translation

Choose `translation_provider=agent` to lock translation to the connected LLM.
The plan sets Stage5 translation usage to zero and forbids an automatic Stage5
fallback. Transcript batches follow punctuation and timing boundaries, include
neighboring read-only context, speaker/topic fields when known, the immutable
profile glossary, and stable cue IDs. A submission is accepted only when it
matches the exact outstanding batch: missing, duplicate, extra, empty, stale,
or invented IDs are rejected without changing timestamps or source text.

The built-in `stage5_korean` profile contains the default natural Korean style,
subtitle line limits, recurring-name glossary, output presets, and metadata and
publishing preferences. Saved profiles cannot contain credentials. A plan
retains the exact profile revision and per-video glossary that existed when it
was created, so later preference edits cannot silently change an active job.
Profile output presets are durable recommendations; because rendering is costly
in time and disk space, the caller still selects the desired presets explicitly
in `plan_job` and later authorizes the full render after validation.

Mock mode provisions a versioned, durable local video clip and an immutable
sample transcript. It can exercise translation batches, preview generation,
rendering, verification, and manifest publication end to end without Stage5
inference credits.

For a video plus an existing transcript, `transcription_method` must be
`imported_transcript` and `imported_transcript_path` must name the exact SRT.
The plan binds its cue content and the source video's SHA-256. It never imports
whatever subtitles happen to be mounted in the active tab. Library-item imports
likewise bind both exact media bytes and exact stored cue content. Requesting
highlights implies the summary stage and includes that provider's credit estimate
instead of silently ignoring the option.

`validate_translation` reports missing/untranslated cues, invalid timing,
overlaps and gaps, reading speed, display duration, line count/length, broken
punctuation and broken-character encoding markers, duplicate text, glossary inconsistencies,
suspicious untranslated English, and media-duration mismatch. Failed validation
can issue correction-only review batches and rendering stays blocked until the
errors are resolved. Counts always cover the complete subtitle document, while a
single response retains at most 100 issue details to keep the MCP payload and
persistent job record bounded. Error details take priority over warnings; if
`issues_truncated` is true, correct the returned segments and validate again to
surface the next bounded set.

Character validation detects invalid/control Unicode data; it does not claim to
prove that every installed font contains every glyph. Use `render_preview` and
inspect its frames for that visual guarantee before authorizing the full encode.

### Rendering, verification, and manifest

A job can render representative beginning/middle/end previews before encoding.
Supported output presets are `youtube_1080p`, `youtube_4k`,
`x_long_video_720p`, `x_long_video_1080p`, `archive_master`, and
`preview_low_resolution`. Subtitle output can be SRT, VTT, or ASS. Output names
and directories are fixed in the plan, writes remain inside the user's allowed
directories, existing destinations fail unless overwrite was explicitly
planned, every preview and finished-verification frame name participates in the
same preflight collision check, planned outputs are forbidden from overlapping
any media or transcript input even when overwrite is enabled, and one
subtitle-burned intermediate is reused across presets.

Local and library video bytes are hashed during planning and rechecked before
media-consuming stages. Downloaded, transcribed, dubbed, and rendered app
artifacts receive durable size/SHA-256 checkpoints when their producing stage
completes. Preview and final rendering recheck the selected checkpoint and, for
a dubbing plan, consume the exact durable dubbed master rather than falling back
to the original audio. A changed or unbound artifact fails closed before another
stage can consume it.

Every encoded file receives an operation-bound ownership receipt. Verification
requires that exact receipt and checks codecs, dimensions, frame rate, duration,
pixel format, fast-start layout, byte size, platform limits, and SHA-256. It then
extracts operation-bound beginning/middle/end frames from each finished render,
rehashes them independently, and records them separately from the pre-encode
subtitle-style preview. The final `<base_name>-manifest.json` includes source
identity, outputs, both frame sets, sizes, hashes, verification, validation,
credit observations, and stage audit data. Manifest creation rehashes rendered
artifacts and rejects anything modified after verification.
When translation is requested, the manifest also retains a separate
`<base_name>-source.srt`; requested SRT/VTT/ASS files contain the translated
subtitle document. The manifest labels its event cursor and stage snapshot as
the preparation checkpoint rather than claiming they are post-write events.
It also provides a compact file map and structured metadata inputs from the
source probe and optional summary/highlight stage, so an agent can prepare final
publishing copy without scraping the stage audit log.

`prepare_youtube_upload` and `prepare_x_post` validate a current verified
platform artifact and return a complete draft descriptor with the configured
account/channel and visibility. They do not upload, create a remote draft, or
publish. Those external side effects remain deliberately separate and
human-controlled.

## Translation workflow

The MCP server exposes:

- `create_translation_session`
- `get_translation_batch`
- `submit_translation_batch`
- `translation_session_status`
- `export_translation_srt`

A client creates a session from a source SRT, repeatedly requests batches of up
to 20 cues, submits text keyed by stable cue IDs, and exports after all cues are
complete. Review mode returns translated but unreviewed cues and accepts safe
revisions without changing source text.

Sessions are written atomically beneath `~/.translator-agent/sessions` with
owner-only file permissions. Set `TRANSLATOR_AGENT_SESSION_ROOT` to use a
different directory.

## Development-app controls

The server also exposes:

- `app_launch`
- `app_status`
- `app_navigation_list`
- `app_navigate`
- `app_open_web_page`
- `app_open_credit_checkout`
- `app_open_video`
- `app_mount_subtitles`
- `app_set_subtitle_display`
- `app_set_subtitle_style`
- `app_show_download_history`
- `app_downloads_list`
- `app_downloads_open`
- `app_downloads_redownload`
- `app_start_video_download`
- `app_start_transcription`
- `app_start_translation`
- `app_start_dubbing`
- `app_start_summary`
- `app_start_cue_translation`
- `app_start_cue_transcription`
- `app_start_merge`
- `app_start_media_workflow`
- `app_processing_status`
- `app_processing_cancel`
- `app_subtitles_get`
- `app_subtitles_update`
- `app_subtitles_mutate`
- `app_subtitles_export`
- `app_video_search`
- `app_video_search_more`
- `app_video_search_status`
- `app_video_search_cancel`
- `app_video_batch_download`
- `app_video_batch_cancel`
- `app_video_batch_status`
- `app_settings_show`
- `app_settings_get`
- `app_settings_update`
- `app_settings_store_provider_key`
- `app_settings_clear_provider_key`

Display modes are `original`, `translation`, and `dual`. Styles are `Default`,
`Classic`, `Boxed`, and `LineBox`.

Navigation is a user-visible handoff. The agent can focus named Translator
destinations (home, creation, video search, Downloads, channels, editor, and
specific Settings sections) or open an explicit HTTP(S) page in the default
browser. It cannot transfer browser credentials, fill forms, click through a
web page, or submit anything.

`app_open_credit_checkout` opens the Credits section and launches a selected
pack in Stripe. Creating the session does not charge the user. Card entry,
payment review, and final submission remain manual, and no payment fields are
visible to the agent.

`app_start_video_download` accepts an explicit `http` or `https` URL and one of
Translator's existing quality choices. It starts the normal app downloader and
adds a successful result to the Downloads library. The caller polls
`app_status` for progress, completion, cookie requirements, or errors. The tool
does not add any geo-bypass, access-control bypass, or hidden scraping behavior.
Opening another local/library video, mounting another SRT, or starting a
download also defaults to `replace_subtitles=fail`; existing cue work is not
silently cleared during a source switch.

`app_start_media_workflow` is the complete creation path. It accepts an
explicit URL, an explicit local path, or the already mounted video and can stop
after download/open, transcription, summary/highlights, translation, or
dubbing. The individual
start tools operate on the currently mounted media. They return immediately so
long jobs never monopolize the MCP request; poll `app_processing_status` and use
`app_processing_cancel` when needed. Replacing mounted subtitles is explicit:
the caller must choose fail, save, or discard instead of triggering a hidden
native confirmation dialog.

The subtitle tools page through mounted cues by stable ID, apply bounded text or
timing updates, insert/remove/shift cues, rerun one cue's transcription or
translation with context, and export to an explicit SRT path without a native
save dialog. A cue removal requires the explicit value `REMOVE`, and paid
single-cue inference preserves the existing cue unless a replacement succeeds.
Together these tools let an agent inspect and hand off the actual transcription
result rather than merely observe a cue count.

`app_start_merge` burns the mounted subtitle document into the mounted source
video using the current display mode and style. It requires an explicit absolute
`.mp4` output path, never opens the native save dialog, and uses the same
progress/cancellation channel as the visible merge workflow.

The Downloads tools use the app's authoritative saved library. A caller lists
entries and receives stable IDs plus local-file availability, then uses an ID to
open an existing file or re-download the entry's already-saved source URL. The
interface does not crawl directories, match brittle titles, or expose arbitrary
filesystem operations.

The video-search tools use Translator's existing ranked YouTube recommender,
including its current country, recency, language, download-history context, and
model configuration. A new search can consume Stage5 credits or bill a selected
BYO provider; status and result inspection do not. Results carry stable IDs for
the current search. Up to eight selected IDs can be queued for sequential
download into the app library without mounting each file or opening repeated
source-switch prompts. The queue stops for cookie/manual-verification failures
and can be cancelled.

The settings tools cover every local preference shown by the regular Settings
experience: translation and summary quality, review provider, dubbing quality,
voice and ambient mix, video-recommendation quality, Stage5/BYO mode, provider
toggles, and provider/model preferences. The snapshot includes credit state,
entitlements, and whether each provider key is present.

Stored provider-key values are never readable through the interface. A key can
be validated and replaced through an explicit write-only tool; clearing one
requires the literal confirmation value `CLEAR`. Credit purchases, BYO
entitlement checkout, and admin credit resets remain manual-only because they
cross commerce or privileged-account boundaries.

## Development vs Production Agent Control

### Development Mode

The renderer bridge exists when the app is unpackaged and launched with
`TRANSLATOR_AGENT_DEV=1`. The dev MCP server (`npm run agent:mcp`) starts the
development build with Playwright and that flag automatically. Run the MCP
entry point through the native supervisor as a direct child of the controlling
client, as the checked-in `.codex/config.toml` does. The supervisor contains
the controller process group from launch. Because Playwright deliberately
detaches Electron into another process group, an exact native launch wrapper
arms a parent guardian before it execs Electron. An inner native process
monitor then observes that same launched root after Playwright returns it;
inherited stdio descriptors cannot hide owner death in either interval.

SIGINT, SIGTERM, SIGHUP, parent-process disconnect, stdin/readline closure,
stdio failure, and MCP transport closure all enter one idempotent shutdown
path. A normal explicit quit awaits the single Playwright close request for up
to 10 seconds. Exact ownership loss, or the expiry of that already-requested
quit grace period, invokes the independent exact-process force path.

### Production/Packaged Mode

Packaged builds (`/Applications/Translator.app` on macOS, installed app on Windows)
expose agent control only after explicit user permission:

1. Launch Translator.app
2. Go to Settings → Agent Control
3. Enable "Allow agent control of this app"
4. Configure allowed directories for file writes (exports, merged videos)

When enabled, a local IPC socket server runs within the app. The packaged MCP
helper (`packaged-mcp.mjs`) connects to this socket and exposes the same stdio
MCP interface as dev mode:

**macOS:**

```bash
/Applications/Translator.app/Contents/Resources/translator-mcp
```

**Windows:**

```cmd
C:\Program Files\Translator\resources\translator-mcp.cmd
```

The launcher runs the zero-dependency helper with Translator's bundled
Electron runtime in Node mode; users do not need to install Node.js separately.
The native launcher supervisor binds the helper to the exact MCP client process
instead of inferring ownership from EOF or descriptor state. The helper also
observes stdio/transport closure directly and releases any app socket before
exit.

Translator rotates a random local-socket generation token every time agent
control starts. The helper must authenticate that exact protocol version and
generation before forwarding a method. Legacy discovery files and stale
helpers are rejected without being treated as a live client. Installed legacy
helpers are not changed retroactively: install and restart the updated app,
then restart the MCP client to use this lifecycle.

Each packaged helper process also receives one opaque workspace lease. The
lease keeps its mounted-media, status, cancellation, search, batch, and subtitle
calls on the same tab even when the user changes the visible tab or the helper
releases and reconnects its idle app socket. Closing that owned tab or losing an
expired lease fails closed; restart the MCP helper to deliberately bind it to a
different active tab. History-item jobs retain their own per-job routes so
multiple tabs can process independent library work concurrently.

Add this path to your MCP client (Cursor, Codex, etc.) configuration. The
agent control setting persists across app launches and can be disabled at any
time (kill switch).

## Parity status

The core creation workflow now has direct MCP coverage: explicit media/SRT
opening, URL download, transcription, translation, dubbing, summary/highlight
analysis, cue inspection and editing, SRT export, subtitle burn-in merge,
progress, cancellation, library reuse, and recommendation-driven batch
downloads. Source switches and destructive cue changes fail closed by default.
URL downloads keep the currently mounted work intact until the replacement has
actually downloaded and passed validation; a failed source acquisition cannot
discard the current subtitle document.

This is not yet a claim that every secondary UI gesture has an MCP equivalent.
The remaining app-local parity work is tracked explicitly: selecting,
reordering, cutting, combining, and exporting generated highlight clips;
recent-media removal; playback/seek transport; watched-channel management; and
persisting an MCP-generated analysis back into the visible summary-history UI.
Those are engineering gaps, not actions that inherently require a human.

Authentication challenges, cookie consent/verification, payment entry and
submission, privileged administration, and OS/platform security prompts remain
human-gated by design. Packaged-app MCP requires explicit user permission via
the in-product Settings UI and respects allowed-directory controls and the kill
switch.

## Run and test

```bash
npm install
npm run agent:test
npm run agent:mcp
```

The test suite covers the persistent translation/review loop and a real MCP
client/server round trip. The development app controller has also been
dogfooded against a current local video and bilingual SRT.

## Connect Codex

The repository contains a portable `.codex/config.toml`, so a trusted Codex
project can start the stdio server automatically. From another client or from a
repository cloned somewhere else, use that checkout's own absolute path. For
example:

```bash
codex mcp add translator -- /absolute/path/to/translator/packages/agent-server/bin/translator-owner-supervisor --supervise 1 -- node /absolute/path/to/translator/packages/agent-server/src/mcp.mjs
```

Restart the Codex client after adding or changing MCP configuration. Use
`/mcp` or `codex mcp list` to inspect the connection. Project configuration
prompts for tools that write files or mutate the development app.

## Security boundary

- No HTTP listener, remote exposure, or bearer token is needed for stdio.
- The free tool set does not invoke paid Translator AI operations.
- App control is off by default in packaged mode and requires explicit user permission.
- In development mode, agent control requires `TRANSLATOR_AGENT_DEV=1` flag.
- Packaged mode includes an in-product permission screen (Settings → Agent Control).
- Visible agent-operation status shown in Settings when enabled.
- Kill switch allows immediate disabling of agent control.
- File writes (exports, merged videos) restricted to user-configured allowed directories.
- Translation updates must use cue IDs from the current session.
- Export refuses incomplete translation or dual files.
- Source subtitle text is never overwritten by review submissions.
- File paths are explicit; no directory crawling or customer-data discovery is
  exposed as an MCP tool.
- Downloads library actions use stable app-owned entry IDs; they cannot select
  arbitrary local paths.
- Long-running media processing is single-flight, status-driven, cancellable,
  and uses the same credit/BYO routing and durable artifact storage as the UI.
- Existing mounted subtitles are never silently destroyed: replacement must be
  explicitly set to fail, save, or discard, and a URL replacement is deferred
  until the new source is available.
- Subtitle reads and writes are bounded to 100 stable-ID cues per call; export
  writes only to an explicit absolute `.srt` path. Existing files require the
  separate confirmation value `OVERWRITE`.
- Automated merge writes only to its explicit absolute `.mp4` output path and
  validates the destination before rendering. File writes outside allowed directories
  are rejected. Existing files require the separate confirmation value `OVERWRITE`,
  after which the app retains its transactional backup/restore behavior.
- Settings snapshots reveal key presence, never secret values.
- Checkout pages may be opened, but entering payment details, completing a
  purchase, and privileged admin resets are not agent actions.
