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
