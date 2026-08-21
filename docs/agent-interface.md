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
development build with Playwright and that flag automatically.

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
/Applications/Translator.app/Contents/Resources/agent-mcp/packaged-mcp.mjs
```

**Windows:**
```cmd
%LOCALAPPDATA%\Programs\Translator\resources\agent-mcp\packaged-mcp.mjs
```

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
codex mcp add translator -- node /absolute/path/to/translator/packages/agent-server/src/mcp.mjs
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
