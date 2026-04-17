<p align="center">
  <img src="assets/icon.png" alt="Stage5 Translator" width="128" height="128">
</p>

<h1 align="center">Stage5 Translator</h1>

<p align="center">
  <strong>AI-powered video translation for content creators</strong>
</p>

<p align="center">
  <a href="https://stage5.tools">
    <img src="https://img.shields.io/badge/Download-stage5.tools-blue?style=for-the-badge" alt="Download">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-191970?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey?style=flat-square" alt="Platform">
</p>

<p align="center">
  Transcribe, translate, and dub videos in 30+ languages with state-of-the-art AI models.
  <br>
  Free tools included. No account required.
</p>

---

## ✨ Features

### 🆓 Free Forever
- **Video Download** — Save videos from YouTube and other platforms
- **Subtitle Editor** — Edit, sync, and style your subtitles
- **Subtitle Merge** — Burn subtitles directly into your videos
- **Highlight Clips** — Extract the best moments automatically

### 💎 AI-Powered (Credits)
- **Transcription** — Convert speech to text with OpenAI Whisper
- **Translation** — GPT-5.1 draft + Claude Opus 4.7 review for premium quality
- **Dubbing** — Generate natural voice-overs in any target language
- **Smart Summaries** — AI-generated video summaries and highlights

### 🌍 30+ Languages
Arabic, Chinese, Czech, Danish, Dutch, English, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Malay, Norwegian, Polish, Portuguese, Romanian, Russian, Spanish, Swedish, Thai, Turkish, Ukrainian, Vietnamese, and more.

---

## 📸 Screenshots

<p align="center">
  <em>Screenshots coming soon</em>
</p>

<!--
<p align="center">
  <img src="docs/screenshots/transcribe.png" width="45%" alt="Transcription">
  <img src="docs/screenshots/translate.png" width="45%" alt="Translation">
</p>
-->

---

## 🚀 Installation

### Download
Visit **[stage5.tools](https://stage5.tools)** to download the latest version for your platform.

| Platform | Chip | Download |
|----------|------|----------|
| macOS | Apple Silicon (M1/M2/M3/M4) | [Download](https://stage5.tools) |
| macOS | Intel | [Download](https://stage5.tools) |
| Windows | x64 | [Download](https://stage5.tools) |

### Build from Source
```bash
# Clone the repository
git clone https://github.com/mikey1384/translator.git
cd translator

# Install dependencies
npm install

# Start development mode
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package:arm    # macOS Apple Silicon
npm run package:intel  # macOS Intel
npm run package:win    # Windows
```

---

## 🔄 How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Video     │────▶│  Transcribe │────▶│  Translate  │────▶│     Dub     │
│   Input     │     │  (Whisper)  │     │ (GPT+Claude)│     │    (TTS)    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

1. **Input** — Load a video file or paste a URL
2. **Transcribe** — AI converts speech to subtitles with timestamps
3. **Translate** — Two-pass translation: GPT-5.1 drafts, Claude Opus 4.7 reviews
4. **Dub** — Generate natural voice-over in the target language
5. **Export** — Download subtitles (SRT) or video with burned-in captions

---

## 💰 Pricing

Stage5 uses a **credit-based** system — pay only for what you use.

| Feature | Cost |
|---------|------|
| Video Download | **Free** |
| Subtitle Editing | **Free** |
| Subtitle Merge | **Free** |
| AI Transcription | Credits |
| AI Translation | Credits |
| AI Dubbing | Credits |

**New users get free credits to try AI features.** Purchase more credits anytime at [stage5.tools](https://stage5.tools).

### 🔑 Bring Your Own API Keys
Power users can connect their own OpenAI, Anthropic, or ElevenLabs API keys to use AI features without credits. Enable BYO mode in Settings.

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 36 |
| Frontend | React 18, Zustand |
| Language | TypeScript |
| Styling | Emotion CSS |
| Video Processing | FFmpeg |
| AI Models | OpenAI GPT-5.1, Claude Opus 4.7, Whisper |

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please read our contributing guidelines before submitting PRs.

### Development Setup
```bash
npm install    # Install dependencies
npm run dev    # Start with hot reload
npm run lint   # Check for issues
npm run build  # Production build
```

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ by the Stage5 team
  <br>
  <a href="https://stage5.tools">stage5.tools</a>
</p>
