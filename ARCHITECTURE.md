# Translator architecture

Translator is an Electron desktop application organized around independent video workspaces. This document describes the boundaries that matter most when reviewing or changing the system.

## Process model

### Electron main process

`packages/main` owns operating-system and privileged work:

- app windows and the multitab shell;
- video and audio download processes;
- file-system access, native dependencies, and bundled binaries;
- secure settings and provider-key storage;
- Stage5 API, payment, entitlement, and update coordination;
- background-job lifecycle, cancellation, cleanup, and recovery.

Each app tab is represented by an independently managed workspace. The active workspace remains interactive while background tabs can continue reporting progress and completion state through the shell.

### Preload bridge

`packages/preload` exposes the narrow bridge used by the renderer. Privileged operations should enter the main process through typed IPC contracts rather than by expanding renderer privileges.

### Renderer

`packages/renderer` is the React interface: video discovery, playback, transcription controls, subtitle comparison and editing, translation, dubbing, summaries, clips, settings, credits, and localization.

The renderer should treat network and native operations as asynchronous jobs. It must preserve cancellation, progress, retry, and user-visible failure semantics rather than assuming a request completes immediately.

### Shared code

`packages/shared` contains wire contracts, model identifiers, pricing inputs, target-language definitions, subtitle helpers, and other cross-process types. Changes here should be checked for drift across main, preload, renderer, and the Stage5 API.

## Data and trust boundaries

### Local product data

Video files, subtitle documents, editing state, playback positions, and app preferences are handled by the desktop client. Some state is persisted in Electron-managed application storage so work can survive restarts.

### Provider credentials

Supported bring-your-own OpenAI, Anthropic, and ElevenLabs credentials are entered in the desktop app and stored through the app's secure-storage path. Do not log, serialize into analytics, place in renderer-readable plain text, or send provider credentials to unrelated services.

### Hosted Stage5 services

Stage5 credits, entitlements, payment fulfillment, and hosted AI execution communicate with the separate Stage5 API. The desktop repository is MIT-licensed; hosted infrastructure and third-party accounts are separate services and are not implied to be open source by the client license.

### Third-party sources

Video discovery and downloading interact with public video sources and supporting tools. Source availability and permitted use depend on the source platform, content rights, geography, and the user's intended use. Code changes must not bypass access controls or platform restrictions.

## Translation and media pipeline

A typical job moves through these stages:

1. Import a local file or resolve a permitted video source.
2. Reuse existing subtitles or transcribe the audio.
3. Produce a base subtitle translation.
4. Optionally run a second review pass.
5. Compare, edit, search, and retime subtitles against the video.
6. Export SRT, render subtitles into video, generate a summary or clips, or synthesize dubbing.

The exact provider and model depend on user settings, Stage5 availability, and BYO configuration. Model identifiers and current routing live in the shared model catalog rather than in this document.

## Reliability rules

- Every long-running job needs cancellation and cleanup behavior.
- A closed or navigated tab must not leave an unowned process or upload behind.
- Renderer reloads and checkout returns must not duplicate billing or fulfillment.
- IPC senders must be checked for liveness before replies are delivered.
- Temporary files and source-linked subtitle state need explicit ownership.
- Update, packaging, and native-binary changes must be tested per architecture.

## Where to start

- Tab shell and workspace lifecycle: `packages/main/tab-manager.ts`
- Main entry and handlers: `packages/main/index.ts`, `packages/main/handlers`
- Renderer entry: `packages/renderer/index.tsx`
- App interface types: `packages/shared/types/app.d.ts`
- Model catalog: `packages/shared/constants/model-catalog.ts`
- Build and packaging: root `package.json`, `electron-builder.*.json`, and `scripts/`
