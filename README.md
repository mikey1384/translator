<p align="center">
  <a href="https://translator.tools">
    <img src="assets/icon.png" alt="Translator app icon" width="120" height="120">
  </a>
</p>

<h1 align="center">Translator</h1>

<p align="center">
  <strong>An open-source desktop video workstation for crossing language boundaries.</strong>
</p>

<p align="center">
  Discover, download, transcribe, translate, review, edit, dub, and export video<br>
  without reducing the workflow to a pile of disconnected browser tools.
</p>

<p align="center">
  <a href="https://translator.tools/#all-downloads"><strong>Download the app</strong></a>
  ·
  <a href="https://translator.tools/open-source">Open-source overview</a>
  ·
  <a href="https://translator.tools/pricing">Pricing</a>
  ·
  <a href="https://translator.tools/faq">FAQ</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/mikey1384/translator?display_name=tag&sort=semver" alt="Latest release">
  <img src="https://img.shields.io/badge/license-MIT-8a9cff" alt="MIT license">
  <img src="https://img.shields.io/badge/platform-macOS%20%2B%20Windows-20242c" alt="macOS and Windows">
  <img src="https://img.shields.io/badge/Electron-39-47848f?logo=electron" alt="Electron 39">
  <img src="https://img.shields.io/badge/TypeScript-source-3178c6?logo=typescript&logoColor=white" alt="TypeScript source">
</p>

![Translator with multiple video workspaces open in tabs](https://translator.tools/screenshots/watch-translated-subtitles-editorial-2026-08.webp)

## Why Translator exists

Most video-language workflows make you move a file through separate downloaders, transcription pages, translation boxes, subtitle editors, dubbing tools, and export utilities. Translator keeps that work in one desktop application.

Its defining interface is a **multitab workspace**. Each tab holds an independent video job, background work reports progress in the tab strip, and completed work stays organized instead of replacing the thing you were already doing.

This repository contains the real desktop product—not a demonstration client or a marketing sample.

## What the app does

| Area               | Capabilities                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Workspaces         | Multiple independent video tabs, background progress, completion state, and preserved task context                    |
| Discovery          | AI-assisted video discovery beyond the user's usual recommendation feed                                               |
| Input              | Local video files, video URLs, subtitle files, and source-linked subtitle documents                                   |
| Downloading        | Video and audio downloading with quality choices and a reusable in-app history for watching or reopening saved videos |
| Transcription      | Whisper or ElevenLabs transcription paths, including higher-quality contextual workflows                              |
| Translation        | 39 target languages, GPT-5.1 base translation, and optional second-pass review with GPT-5.5 or Claude Opus 4.8        |
| Review and editing | Original/translated comparison, video-synchronized subtitle editing, timing controls, search, and replacement         |
| Output             | SRT export, burned-in subtitles, summaries, highlight clips, and dubbed video                                         |
| Payment choice     | Stage5 pay-as-you-go credits or supported bring-your-own OpenAI, Anthropic, and ElevenLabs credentials                |

Core downloading, subtitle editing, timing, and export tools are available in the free finished app. Optional AI operations incur Stage5 credit charges or third-party provider costs when BYO credentials are used.

## Use Translator with an LLM agent

Translator includes a local MCP server for a slower, zero-marginal-API-cost
translation and review path. The connected LLM reads subtitle cues in small
contextual batches, supplies the translated or revised text from its existing
subscription, and exports a translation-only or bilingual SRT. Translator does
not call a paid model for this path.

The MCP v2 workflow adds no-cost source probing and immutable planning before
work starts. Every result identifies the development or production environment,
the app and server versions, the connected Stage5 account and credit snapshot
(including whether it is authoritative), and whether the operation can consume
credit. A paid stage requires a fresh authoritative balance and an explicit
authorization of its current estimate; the estimate gate prevents an unintended
start, while settled provider usage remains the billing authority.
Retrying a paid stage requires a separate literal confirmation so an uncertain
earlier delivery cannot turn an automatic retry into duplicate spend.

Long workflows are durable SQLite jobs with stable operation IDs, event cursors,
checkpoint pause/resume/cancel/retry controls, exact-source duplicate detection,
and concise artifact references. External-agent translation uses semantic
batches with immutable cue IDs, overlapping read-only context, saved glossaries,
and exact batch validation. Subtitle QA, representative preview frames,
multi-platform render presets, output ownership receipts, post-render media
inspection, hashed beginning/middle/end frames from every finished render,
SHA-256 integrity checks, and a final `<base_name>-manifest.json` are part of
the same recoverable workflow. Upload preparation is available, but no MCP tool
uploads or publishes to YouTube or X.

Mock mode generates a durable local sample clip and transcript, so an agent can
exercise planning, translation, preview, rendering, verification, and manifest
creation without Stage5 inference credit. Translated jobs publish a separate
`<base_name>-source.srt` alongside the requested translated subtitle formats.

The agent bridge also lets an agent download an explicit video URL into
the local library, open a local video, mount an SRT, switch among original,
translation, and dual-text display, choose Default, Classic, Boxed, or LineBox
subtitle styling, and list, open, or re-download items from the Downloads
library by stable entry ID. It can also use Translator's ranked video search,
continue a search, and queue selected recommendation IDs for bounded sequential
downloads.

The agent can navigate directly to named app destinations, open an
explicit web page for the user, or hand off to a secure Stage5 credit checkout.
It cannot read or submit payment fields.
It can also inspect and operate Settings through typed controls for quality,
voice, provider, model, and BYO preferences. Provider keys are write-only and
masked; purchases, entitlement checkout, and admin resets remain manual.

### Development Mode

```bash
npm run agent:test
npm run agent:mcp
```

The repository MCP configuration launches the controller through the native
owner supervisor. Playwright's detached Electron spawn enters an exact native
launch wrapper, which arms a parent guardian before exec and retains Electron's
process-group identity. This covers owner loss before Playwright returns the
Electron handle and independently of stdio EOF. An inner exact process monitor
then tracks the same root. Controller shutdown is idempotent: explicit quit
allows one 10-second Playwright grace period, while ownership loss takes the
independent force path immediately.

### Production/Installed App

Agent control is available in packaged builds with explicit user permission:

1. Launch Translator.app (or installed Windows app)
2. Go to **Settings → Agent Control**
3. Enable "Allow agent control of this app"
4. Configure allowed directories for file writes

Then point your MCP client (Cursor, Codex, etc.) to the packaged helper:

**macOS:**

```
/Applications/Translator.app/Contents/Resources/translator-mcp
```

**Windows:**

```
C:\Program Files\Translator\resources\translator-mcp.cmd
```

These launchers use the Node runtime already bundled with Translator, so a
separate Node.js installation is not required. They also supervise the exact
MCP client and terminate the helper if that client exits, even if another
process inherited every stdio descriptor. Each Translator start publishes a
new authenticated local-socket generation, so stale helpers cannot attach to a
restarted app. After updating Translator, restart both the app and MCP client
to activate the new launcher and generation.

MCP v2 job state is stored per environment under
`~/.translator-agent/v2/{production,development}.sqlite3`. A helper that owns a
stage publishes a private, token-authenticated local lease, so another helper
can distinguish a live start from a genuinely abandoned one without a polling
or heartbeat guess. Private ownership credentials are never returned in tool
results.

Agent control includes a kill switch and can be disabled at any time from Settings.

See [docs/agent-interface.md](docs/agent-interface.md) for the complete tool workflow,
security boundary, and current limitations.

## Open-source boundary

The **desktop client is MIT-licensed**. You can audit it, modify it, build it, and redistribute it under the terms of the license.

Open source does not imply that external infrastructure is free or included in this repository. Hosted Stage5 APIs, payment systems, model-provider accounts, and third-party services remain separate. The code makes those boundaries inspectable instead of hiding them behind a generic architecture claim.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the process and trust boundaries.

## Download a finished build

Use the signed downloads at [translator.tools](https://translator.tools/#all-downloads):

- macOS — Apple Silicon
- macOS — Intel
- Windows — x64

No subscription is required. See the current [pricing page](https://translator.tools/pricing) for optional AI usage and BYO details.

## Run from source

Prerequisites:

- A current Node.js LTS release and npm
- macOS or Windows
- Platform build tools required by Electron native dependencies

```bash
git clone https://github.com/mikey1384/translator.git
cd translator
npm install
npm run dev
```

The first development start builds the Electron main process, preload bridge, renderer, and render host before launching the app.

## Build and verify

```bash
# Compile the application
npm run build

# Static checks
npm run lint

# Main, agent lifecycle, renderer, shared, and release-script suites
npm test
```

Packaging requires platform-specific native dependencies and, for distributable macOS builds, signing and notarization credentials. The repository's release scripts encode those paths:

```bash
npm run package:arm     # macOS Apple Silicon
npm run package:intel   # macOS Intel
npm run package:win     # Windows x64
```

## Repository map

```text
packages/main/       Electron main process, tabs, jobs, downloads, APIs, storage
packages/preload/    Typed bridge between the desktop shell and renderer
packages/renderer/   React product interface and localized user experience
packages/shared/     Shared constants, types, model catalog, and helpers
packages/agent-server/ Local MCP server, translation sessions, and dev-app controls
scripts/             Packaging, release, native dependency, and verification tools
assets/              Product icons and bundled interface assets
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing process boundaries, IPC contracts, credential handling, or background-job behavior.

## Contributing

Issues and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and use [GitHub Issues](https://github.com/mikey1384/translator/issues) for reproducible bugs and scoped proposals.

For vulnerabilities or reports involving credentials, payments, update delivery, or private data, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

Translator is released under the [MIT License](LICENSE).

---

Built by [Stage5 Tools](https://translator.tools). The product website and this repository are intended to describe the same current application; if they drift, please open an issue.
