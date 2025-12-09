# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
  - `secure-storage.ts` - API key encryption/decryption via keytar

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

## Environment

Uses `.env` file in project root. API keys stored encrypted via electron-store + keytar.
