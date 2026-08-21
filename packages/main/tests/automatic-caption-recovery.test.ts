import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  recoverPublicYouTubeAutomaticCaptions,
  selectOriginalAutomaticCaptionLanguage,
} from '../services/url-processor/automatic-caption-recovery.js';
import {
  DEVELOPMENT_CAPTION_RECOVERY_FIXTURE,
  DEVELOPMENT_CAPTION_RECOVERY_URL,
  loadDevelopmentCaptionRecoveryFixture,
} from '../services/url-processor/development-caption-recovery-fixture.js';

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'youtube-media-403-auto-captions'
);

async function fixture(name: string): Promise<string> {
  return fsp.readFile(path.join(fixtureDir, name), 'utf8');
}

test('recovers the fixture original automatic captions without credentials or media', async t => {
  const outputDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'translator-caption-recovery-')
  );
  t.after(() => fsp.rm(outputDir, { recursive: true, force: true }));
  const commands: string[][] = [];

  const result = await recoverPublicYouTubeAutomaticCaptions({
    url: 'https://www.youtube.com/watch?v=fixture',
    outputDir,
    filePrefix: 'recovery_',
    ffmpegPath: '/fixture/ffmpeg',
    connectionArgs: [
      '--force-ipv4',
      '--socket-timeout',
      '20',
      '--cookies',
      '/fixture/private-cookies.txt',
      '--username=private-user',
      '-uattached-private-user',
      '--extractor-args',
      'youtube:player_client=ios',
      '--geo-verification-proxy',
      'https://private-proxy.invalid',
      '--config-locations=/fixture/private-config',
      '--no-check-certificates',
    ],
    runYtDlp: async args => {
      commands.push(args);
      if (args.includes('--dump-single-json')) {
        return { stdout: await fixture('info.json') };
      }
      const subtitles = await fixture('captions.en-orig.srt');
      await fsp.writeFile(
        path.join(outputDir, 'recovery_fixture.en-orig.srt'),
        subtitles,
        'utf8'
      );
      return { stdout: '' };
    },
  });

  assert.equal(result?.languageCode, 'en-orig');
  assert.match(result?.subtitles || '', /automatic captions/i);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].includes('--skip-download'), true);
  assert.equal(commands[1].includes('--write-auto-subs'), true);
  assert.equal(commands[1].includes('--format'), false);
  assert.equal(commands[1].includes('--cookies'), false);
  assert.equal(commands[1].includes('--cookies-from-browser'), false);
  assert.equal(
    commands[0].some(arg => arg.includes('private-user')),
    false
  );
  assert.equal(commands[0].includes('--extractor-args'), false);
  assert.equal(commands[0].includes('--geo-verification-proxy'), false);
  assert.equal(
    commands[0].some(arg => arg.includes('private-config')),
    false
  );
  assert.equal(commands[0].includes('--no-check-certificates'), false);
  assert.equal(commands[0].includes('--force-ipv4'), true);
  assert.deepEqual(
    commands[0].slice(
      commands[0].indexOf('--socket-timeout'),
      commands[0].indexOf('--socket-timeout') + 2
    ),
    ['--socket-timeout', '20']
  );
  assert.deepEqual(await fsp.readdir(outputDir), []);
});

test('does not choose an arbitrary translated automatic-caption track', () => {
  assert.equal(
    selectOriginalAutomaticCaptionLanguage({
      automatic_captions: {
        en: [{ url: 'https://fixture.invalid/en' }],
        es: [{ url: 'https://fixture.invalid/es' }],
      },
    }),
    null
  );
});

test('fails closed when the public caption request is denied', async t => {
  const outputDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'translator-caption-denied-')
  );
  t.after(() => fsp.rm(outputDir, { recursive: true, force: true }));
  let calls = 0;

  const result = await recoverPublicYouTubeAutomaticCaptions({
    url: 'https://www.youtube.com/watch?v=fixture',
    outputDir,
    filePrefix: 'denied_',
    ffmpegPath: '/fixture/ffmpeg',
    runYtDlp: async args => {
      calls += 1;
      if (args.includes('--dump-single-json')) {
        return { stdout: await fixture('info.json') };
      }
      throw new Error('HTTP Error 403: Forbidden');
    },
  });

  assert.equal(result, null);
  assert.equal(calls, 2);
  assert.deepEqual(await fsp.readdir(outputDir), []);
});

test('the Electron fixture hook is dev-only, fixed to .invalid, and leaves no files', async t => {
  const outputDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'translator-caption-e2e-fixture-')
  );
  t.after(() => fsp.rm(outputDir, { recursive: true, force: true }));
  const appPath = path.resolve(fixtureDir, '../../../../..');

  assert.equal(
    await loadDevelopmentCaptionRecoveryFixture({
      url: DEVELOPMENT_CAPTION_RECOVERY_URL,
      isPackaged: true,
      appPath,
      outputDir,
      enabledFixture: DEVELOPMENT_CAPTION_RECOVERY_FIXTURE,
    }),
    null
  );
  assert.equal(
    await loadDevelopmentCaptionRecoveryFixture({
      url: 'https://www.youtube.com/watch?v=fixture',
      isPackaged: false,
      appPath,
      outputDir,
      enabledFixture: DEVELOPMENT_CAPTION_RECOVERY_FIXTURE,
    }),
    null
  );

  const recovered = await loadDevelopmentCaptionRecoveryFixture({
    url: DEVELOPMENT_CAPTION_RECOVERY_URL,
    isPackaged: false,
    appPath: path.join(appPath, 'packages', 'main'),
    outputDir,
    enabledFixture: DEVELOPMENT_CAPTION_RECOVERY_FIXTURE,
  });
  assert.equal(recovered?.languageCode, 'en-orig');
  assert.match(recovered?.subtitles || '', /not a fresh transcription/i);
  assert.deepEqual(await fsp.readdir(outputDir), []);
});
