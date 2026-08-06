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

It does not make audio transcription or dubbing free. Those require provider
inference or, in a future phase, a bundled local model. Hosted Stage5 AI and BYO
provider workflows keep their existing economics.

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
- `app_video_search`
- `app_video_search_more`
- `app_video_search_status`
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

The renderer bridge exists only when the app is unpackaged and launched with
`TRANSLATOR_AGENT_DEV=1`. Packaged builds do not expose
`window.translatorAgent`. The MCP server starts the development build with that
flag automatically.

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
- App control is development-only and off by default.
- Translation updates must use cue IDs from the current session.
- Export refuses incomplete translation or dual files.
- Source subtitle text is never overwritten by review submissions.
- File paths are explicit; no directory crawling or customer-data discovery is
  exposed as an MCP tool.
- Downloads library actions use stable app-owned entry IDs; they cannot select
  arbitrary local paths.
- Settings snapshots reveal key presence, never secret values.
- Checkout pages may be opened, but entering payment details, completing a
  purchase, and privileged admin resets are not agent actions.

Before packaged-app release, add an in-product permission screen, visible
agent-operation status, explicit allowed directories, and a user-controlled
kill switch.
