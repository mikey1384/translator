# Subtitle Translator

An Electron-based desktop application for generating, translating, and editing subtitles for videos.

## Features

- Generate subtitles from video files using AI
- Translate subtitles to different languages
- Edit subtitles with a user-friendly interface
- Merge subtitles back into video files

## Development

### Prerequisites

- [Bun](https://bun.sh/) - Fast JavaScript runtime and package manager
- Node.js and NPM (comes with Bun)

### Getting Started

1. Clone the repository:

   ```
   git clone https://github.com/yourusername/translator.git
   cd translator
   ```

2. Install dependencies:

   ```
   bun install
   ```

3. Start the development server:
   ```
   bun run dev
   ```

### Building for Production

```
bun run package
```

This will create distributables for your current platform. For specific platforms:

- macOS: `bun run package:mac`
- Windows: `bun run package:win`
- Linux: `bun run package:linux`

## Technologies Used

- Electron - Cross-platform desktop application framework
- React - UI library
- TypeScript - Type-safe JavaScript
- FFmpeg - Media processing
- OpenAI/Anthropic APIs - AI-powered transcription and translation

## License

MIT
