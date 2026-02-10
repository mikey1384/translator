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
Audio → Transcribe (Whisper/Scribe) → Translate (GPT-5.1 draft → Claude Opus review) → Summarize → Dub (TTS)
```

Quality preferences controlled via settings:
- `preferClaudeTranslation` - Use Claude Sonnet for draft instead of GPT
- `preferClaudeReview` - Use Claude Opus for review pass (default: true)
- `preferClaudeSummary` - Use Claude Opus for video summary

## Key Files

- `packages/shared/constants/index.ts` - AI model IDs, credit pricing, error codes
- `packages/main/services/ai-provider.ts` - Provider selection logic
- `packages/main/handlers/settings-handlers.ts` - `SettingsStoreType` definition
- `packages/renderer/state/ai-store.ts` - Frontend AI preference state

## Versioning and Releases

When asked to version bump, tag, and push:

1. **Bump version** in `package.json` (patch for fixes, minor for features)
2. **Commit** with message format: `v{VERSION}: Short description of changes`
3. **Create annotated tag** with user-facing release notes (NO "Co-Authored-By" — this text shows in the app's update popup):
   ```bash
   git tag -a v{VERSION} -m "$(cat <<'EOF'
   v{VERSION}: Short description

   User-friendly explanation of what changed and why.
   EOF
   )"
   ```
4. **Push commit and tag together**: `git push && git push --tags`

The annotated tag triggers GitHub Actions to build and release. The tag body **must not be empty** or the update popup will be skipped.

## Environment

Uses `.env` file in project root. API keys stored encrypted via electron-store (AES-256-GCM).
