# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- **Never commit, push, or tag without explicit user approval.** Always stage changes and wait for the user to confirm before running `git commit`, `git push`, or `git tag`.

## Overview

Stage 5 Translator is an Electron desktop application for AI-powered video translation. It transcribes audio, translates subtitles, and generates dubbed audio using multiple AI providers.

## Commands

```bash
npm run dev          # Start development mode with hot reload
npm run build        # Production build (clean + build all packages)
npm run lint:fix     # Fix ESLint issues
npm run package:arm  # Package for Apple Silicon Mac
npm run package:intel # Package for Intel Mac (requires x86_64 arch)
npm run package:win  # Package for Windows
```

## Architecture

### Electron Process Model

```
packages/main/        → Main process (Node.js)
packages/preload/     → Context bridge (IPC exposure)
packages/renderer/    → Renderer process (React)
packages/shared/      → Shared types and constants
```

### Main Process (`packages/main/`)

- `index.ts` - App entry point, window management, IPC registration
- `handlers/` - IPC request handlers
  - `subtitle-handlers.ts` - Transcription, translation, dubbing orchestration
  - `settings-handlers.ts` - Persistent settings via electron-store
  - `credit-handlers.ts` - Stage5 API credit management
  - `url-handlers.ts` - YouTube/video URL processing
- `services/` - Business logic
  - `ai-provider.ts` - Routes AI requests to Stage5 API or BYO keys (OpenAI/Anthropic/ElevenLabs)
  - `subtitle-processing/` - Core pipeline: transcriber → translator → summarizer → dubber
  - `stage5-client.ts` - Stage5 backend API client
  - `openai-client.ts`, `anthropic-client.ts`, `elevenlabs-client.ts` - Direct API clients
  - `secure-storage.ts` - API key encryption/decryption (AES-256-GCM)

### Renderer Process (`packages/renderer/`)

- `state/` - Zustand stores
  - `ai-store.ts` - API key state, provider preferences, BYO toggles
  - `subtitle-store.ts` - Subtitle data, editing state
  - `task-store.ts` - Background task progress tracking
  - `video-store.ts` - Video playback state
- `containers/` - Page-level components (GenerateSubtitles, EditSubtitles, SettingsPage)
- `ipc/` - Type-safe wrappers for `window.electron.*` calls
- `locales/` - i18n JSON files (10 languages)

### IPC Communication Pattern

1. Renderer calls `window.electron.methodName()` (exposed via preload)
2. Preload bridges to `ipcRenderer.invoke('channel-name', ...args)`
3. Main process handles via `ipcMain.handle('channel-name', handler)`

### AI Provider Routing

The `ai-provider.ts` module decides where to route AI requests:

- **Stage5 API** (default) - Uses platform credits, routes through backend
- **BYO (Bring Your Own)** - Uses user's own API keys directly
  - Requires `useByoMaster` toggle enabled
  - Individual provider toggles: `useByoOpenAi`, `useByoAnthropic`, `useByoElevenLabs`
  - Keys stored encrypted in electron-store, decrypted at runtime

### Translation Pipeline

```
Audio → Transcribe (ElevenLabs Scribe) → Translate (draft → optional review) → Summarize → Dub (ElevenLabs TTS)
```

Model routing (IDs in `packages/shared/constants/model-catalog.ts`):

- **Stage5 credits** (default): drafts on Claude Haiku 5.5, review on Claude Opus 5.5; summaries and AI video search on Claude Sonnet 5.5 (standard) / Claude Opus 5.5 (high). The servers pick these models; GPT ids sent from older settings map to the Claude model of the same tier (`toStage5CreditModel`).
- **API keys** (`useByoMaster`): OpenAI standard tier GPT-6.1 Sol, high tier GPT-5.5; Anthropic Claude Sonnet 5.5 (standard) and Claude Opus 5.5 (high). The `preferClaude*` settings only matter here:
  - `preferClaudeTranslation` (default false) - draft on Claude Sonnet 5.5 instead of GPT-6.1 Sol
  - `preferClaudeReview` (default false) - review on Claude Opus 5.5 instead of GPT-5.5
  - `preferClaudeSummary` (default true) - summaries on Claude instead of GPT

## Key Files

- `packages/shared/constants/index.ts` - AI model IDs, credit pricing, error codes
- `packages/main/services/ai-provider.ts` - Provider selection logic
- `packages/main/handlers/settings-handlers.ts` - `SettingsStoreType` definition
- `packages/renderer/state/ai-store.ts` - Frontend AI preference state

## Versioning and Releases

When asked to version bump, tag, and push:

0. **Treat "release" as "ship the current app state."** If the user asks to release/ship/version bump + tag + push, assume they mean the current codebase state, including already-dirty tracked or untracked app changes. Do **not** silently narrow the release to only the files changed in the current turn. A dirty worktree is not a reason to cut a partial release. Only exclude files when the user explicitly says to exclude them, or when they are obviously non-product scratch artifacts and you have confirmed they should stay out.
1. **Bump version** in `package.json` (patch for fixes, minor for features)
2. **Commit** with message format: `v{VERSION}: Short description of changes`
3. **Create annotated tag** with user-facing release notes (NO "Co-Authored-By" — this shows in the update popup). The first line is the subject; after a blank line, add a non-empty body for the "What's New" popup text. Lightweight tags are not allowed:
   ```bash
   git tag -a v{VERSION} -m "$(cat <<'EOF'
   v{VERSION}: Short description

   - Change one explanation.
   - Change two explanation.
   EOF
   )"
   ```
4. **Push commit and tag together**: `git push && git push --tags`

The GitHub Action handles the macOS release from SemVer tags: it builds, signs, uploads assets, injects the tag body into `latest-mac.yml`, overwrites the GitHub release asset with that enriched updater metadata, and publishes the release body from the same tag annotation. Windows release is manual via `Release-Windows-OneClick.bat`. **Do NOT manually create the SemVer GitHub release with `gh release create`** — a pre-existing non-draft release prevents electron-builder from uploading assets.

**Why the tag annotation matters:** The updater popup is driven by `latest-mac.yml` / `latest.yml`, not by commit messages. The macOS workflow fails if the tag body is empty. The Windows release script resolves notes from `dist/release-notes.txt` or the annotated tag body (fetching the tag from origin if needed) and fails by default if both are missing. This keeps "What's New" text deterministic across platforms.

## Environment

Uses `.env` file in project root. API keys stored encrypted via electron-store (AES-256-GCM).


## Running & Driving the App for E2E Verification (agents)

Use the `run-translator` skill: `.claude/skills/run-translator/SKILL.md`.
It has a working Playwright REPL driver (`driver.mjs`), the FIFO-based
workflow for this tmux-less Mac, and every discovered gotcha: Korean UI
labels, the hidden-panel DOM trap, userData/log paths
(`~/Library/Application Support/@app/main/`, `~/Library/Logs/@app/main/`),
dev-device credit grants via the stage5-api admin route (a review-phase
model call reserves ~34k credits — grant STARTER, not MICRO), and relay
log inspection (`flyctl logs` in `openai-relay/`). Do not rediscover any
of this — read the skill first.

Key invariant learned the hard way: video-suggestion progress IPC events
race the invoke reply, and the renderer store drops events after
`finishOperation` clears `activeOperationId`. Final state must always
ride in the resolved IPC response, not only in trailing progress events.
