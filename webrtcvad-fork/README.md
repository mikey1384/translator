# @stage5/webrtcvad

A fork of [webrtcvad](https://github.com/serenadeai/webrtcvad) with prebuilt binaries for Electron applications.

## Why This Fork?

The original `webrtcvad` package requires native compilation using node-gyp, which means:
- Windows users need Visual Studio Build Tools with C++ workload (500+ MB download)
- Compilation can fail due to missing dependencies
- Installation is slow and error-prone

This fork provides **prebuilt binaries** for:
- ✅ Windows x64 (Electron 35.x)
- ✅ macOS x64 (Electron 35.x) 
- ✅ macOS ARM64 (Electron 35.x)
- ✅ Linux x64 (Electron 35.x)

## Installation

```bash
npm install @stage5/webrtcvad
```

**No Visual Studio Build Tools required!** The package will automatically use prebuilt binaries if available, falling back to compilation only if necessary.

## Usage

Identical to the original webrtcvad package:

```javascript
const vad = require('@stage5/webrtcvad');

// Create VAD instance
const vadInstance = vad.createVAD(vad.Mode.NORMAL);

// Process audio buffer
const isSpeech = vadInstance.processAudio(audioBuffer, sampleRate);
```

## Electron Compatibility

This fork is specifically built for Electron applications and targets:
- Electron 35.0.0
- Electron 35.5.1

## Building Prebuilds

Prebuilds are automatically generated using GitHub Actions. To build manually:

```bash
npm run prebuild
```

## License

MIT - Same as the original webrtcvad package.
