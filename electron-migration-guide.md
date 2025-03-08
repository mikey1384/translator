# Electron Migration Guide for Subtitle + Translation Tool with Bun

## Project Overview

This guide outlines the steps needed to migrate the existing web application (Subtitle + Translation Tool) to an Electron desktop application using Bun as the JavaScript runtime and package manager. The current application consists of a client-side React frontend and a server-side Express backend that handles operations like video processing, subtitle generation, and translation.

## Original Architecture

### Client-Side (WebsiteVersionClient)

- React-based frontend
- Components for uploading and processing videos
- UI for editing and translating subtitles
- Context-based state management

### Server-Side (WebsiteVersionServer)

- Express API backend
- File handling and processing
- Integration with FFmpeg for video/audio manipulation
- Subtitle generation and translation logic
- AI integration for transcription and translation

## Migration Strategy with Bun

### 1. Project Structure with TypeScript

```
translator/
├── main.ts                  # Electron main process (TypeScript)
├── preload.ts               # Preload script (TypeScript)
├── renderer/                # React frontend (migrated from WebsiteVersionClient)
│   ├── components/          # React components (*.tsx)
│   ├── context/             # State management (*.ts/*.tsx)
│   ├── constants/           # Constants and configs (*.ts)
│   ├── helpers/             # Utility functions (*.ts)
│   └── index.tsx            # Renderer entry point
├── electron/                # Electron-specific modules
│   ├── ipc-handlers.ts      # Typed IPC handlers
│   ├── ffmpeg-service.ts    # FFmpeg integration
│   └── ai-service.ts        # AI service integrations
├── api/                     # Backend logic (migrated from WebsiteVersionServer)
│   ├── subtitle-processing.ts  # Subtitle generation
│   ├── media-processing.ts     # Media processing
│   └── ai-integration.ts       # AI integration
├── tests/                   # Unit and integration tests
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
└── index.html               # Electron renderer HTML
```

### 2. Key Components to Migrate

#### Frontend Migration

- Copy the React components from WebsiteVersionClient
- Adjust import paths as needed
- Replace network API calls with IPC (Inter-Process Communication) calls to the main process
- Use Electron's file system APIs for file handling instead of form uploads

#### Backend Migration

- Move the API logic from WebsiteVersionServer to the Electron main process
- Adapt file system operations to use Electron's API
- Package FFmpeg with the application
- Set up IPC handlers for all server functions

### 3. FFmpeg Integration

- Bundle FFmpeg with the Electron app using packages like `ffmpeg-static` or `@ffmpeg-installer/ffmpeg`
- Replace the server-side `child_process.exec` calls with Electron-compatible equivalents
- Create proper paths for temporary file storage within the user's application data directory
- Implement the following FFmpeg operations in Electron:
  - Audio extraction from video files
  - Compressing audio for processing
  - Getting audio duration
  - Trimming leading silence
  - Subtitle embedding and extraction
  - Converting between subtitle formats (SRT ↔ ASS)

### 4. IPC Communication

- Establish IPC channels between the renderer process (UI) and main process (backend)
- Replace HTTP API calls with IPC messages
- Set up event emitters for progress updates for long-running processes
- Create these main IPC channels:
  - `generate-subtitles`: For generating subtitles from video
  - `translate-subtitles`: For translating existing subtitles
  - `merge-subtitles`: For merging subtitles with video
  - `edit-subtitles`: For editing and saving subtitle files
  - `ffmpeg-progress`: For emitting progress updates during processing

### 5. AI Integration

- Replace server-side AI API calls with direct calls from the Electron main process
- Set up proper authentication and API key handling for OpenAI and Anthropic
- Implement these AI-related functions:
  - `generateSubtitlesFromAudio`: Transcribes audio to subtitles
  - `fetchTTSChunks`: Text-to-speech functionality
  - OpenAI streaming functionality for real-time responses
  - Translation capabilities using AI

### 6. File Management

- Implement temporary file management for processing
- Create dedicated storage locations using `app.getPath('userData')`
- Ensure proper cleanup of temporary files after processing
- Set up file watching for changes to subtitle files
- Implement the `cleanupDirectory` function to manage temp files

### 7. Key Utility Functions to Port

- `buildSrt`: Create SRT files from segment arrays
- `parseSrt`: Parse SRT content into structured data
- `secondsToSrtTime`: Format timestamps for SRT files
- `srtTimeToSeconds`: Convert SRT time format to seconds
- `convertSrtToAss`: Convert subtitles between formats
- `adjustTimeString`: Adjust subtitle timing

### 8. Packaging and Distribution

- Configure Electron Forge or electron-builder for packaging
- Include all necessary dependencies (especially FFmpeg)
- Create installers for different platforms (Windows, macOS, Linux)
- Set up automatic updates using Electron Updater

## Using Bun Instead of npm/yarn

### Setting Up the Project with Bun

1. Install Bun:

   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. Initialize a new project:

   ```bash
   bun init -y
   ```

3. Install dependencies:

   ```bash
   bun add react react-dom @emotion/css @emotion/react
   bun add -d electron typescript ts-node electron-builder @types/node @types/react @types/react-dom jest @types/jest ts-jest electron-is-dev electron-log @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe
   ```

4. Configure package.json for Bun:
   ```json
   {
     "scripts": {
       "start": "bun run build && electron .",
       "dev": "tsc && concurrently \"tsc -w\" \"electron .\"",
       "build": "tsc",
       "package": "bun run build && electron-builder build --mac --win --linux",
       "package:mac": "bun run build && electron-builder build --mac",
       "package:win": "bun run build && electron-builder build --win",
       "package:linux": "bun run build && electron-builder build --linux",
       "test": "jest"
     }
   }
   ```

### Benefits of Using Bun

1. **Faster Package Installation**: Bun installs dependencies much faster than npm or yarn
2. **Improved Development Experience**: Faster TypeScript transpilation and bundling
3. **Simplified Workspace**: Bun provides builtin test runner, bundler, and package manager
4. **Better Compatibility**: Bun works with existing npm packages

## Migration Challenges

### FFmpeg Integration

The current application heavily relies on FFmpeg for:

- Video/audio extraction
- Media format conversion
- Subtitle embedding
- Audio analysis

Solution: Use `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` to package FFmpeg with Electron and adapt all command execution functions to use Electron's child_process interface.

### File System Access

The web application uses server-side storage for temporary files during processing.

Solution: Use Electron's app.getPath API to create appropriate temporary directories in the user's system and manage file cleanup on application exit.

### External API Dependencies

Current application relies on external APIs for AI transcription and translation services:

- OpenAI API for text generation and transcription
- Anthropic API for Claude AI integration

Solution: Maintain those API calls from the main process, ensuring proper authentication and error handling. Store API keys securely using Electron's secure storage options.

### Progress Monitoring

The web app uses socket connections to update progress:

- `translationStates` for tracking progress
- Socket events for real-time updates

Solution: Implement an event-based progress reporting system using Electron's IPC to send progress updates from the main process to the renderer.

## Security Considerations

1. **API Key Storage**: Store API keys securely using Electron's `safeStorage` or a secure keychain integration.

2. **IPC Validation**: Validate all data passed through IPC channels to prevent injection attacks.

3. **CSP**: Implement a strong Content Security Policy to prevent XSS attacks.

4. **Update FFmpeg**: Ensure the packaged FFmpeg version is kept up-to-date to prevent security vulnerabilities.

## Next Steps

1. Set up a basic Electron project with React and Bun
2. Create IPC channels for key operations
3. Migrate the simplest API functions first (e.g., SRT parsing/building)
4. Integrate FFmpeg with basic functionality
5. Implement the subtitle generation workflow
6. Add translation capabilities
7. Implement video merging functionality
8. Set up proper error handling and progress reporting
9. Add proper temporary file management
10. Test with sample files
11. Package the application

## Tips

- Start with a simple proof-of-concept that just loads the UI
- Migrate one feature at a time (e.g., first video loading, then subtitle generation, then translation)
- Use Electron DevTools for debugging
- Test frequently as you migrate each piece
- Take advantage of Bun's speed for faster development cycles
- Consider using Electron's builder tools for packaging from the beginning
