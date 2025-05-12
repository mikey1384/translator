/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
export default {
  appId: 'com.translator-app',
  productName: 'Translator',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: [
    'packages/main/dist/**/*',
    'packages/preload/dist/**/*',
    'packages/renderer/dist/**/*',
    'assets/**/*',
    // Include FFmpeg binaries and package files but exclude package.json
    '!**/node_modules/@ffmpeg-installer/**/package.json',
    'node_modules/@ffmpeg-installer/**/ffmpeg',
    '!**/node_modules/@ffprobe-installer/**/package.json',
    'node_modules/@ffprobe-installer/**/ffprobe',
  ],
  asarUnpack: [
    // Ensure FFmpeg binaries are unpacked outside the asar archive
    'node_modules/@ffmpeg-installer/**/ffmpeg',
    'node_modules/@ffprobe-installer/**/ffprobe',
  ],
  extraMetadata: {
    main: 'packages/main/dist/index.js',
  },
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
    ],
    category: 'public.app-category.utilities',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'entitlements.mac.plist',
    entitlementsInherit: 'entitlements.mac.inherit.plist',
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
    ],
    category: 'Utility',
  },
  publish: null,
  afterSign: 'electron-notarize.cjs',
};
