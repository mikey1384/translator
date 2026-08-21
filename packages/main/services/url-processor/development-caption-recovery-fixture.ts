import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  recoverPublicYouTubeAutomaticCaptions,
  type AutomaticCaptionRecoveryResult,
} from './automatic-caption-recovery.js';
import { classifyUrlDownloadFailureDetail } from './failure-taxonomy.js';

export const DEVELOPMENT_CAPTION_RECOVERY_FIXTURE =
  'youtube-media-403-auto-captions';
export const DEVELOPMENT_CAPTION_RECOVERY_URL =
  'https://fixture.invalid/youtube-media-403-auto-captions';

type Options = {
  url: string;
  isPackaged: boolean;
  appPath: string;
  outputDir: string;
  enabledFixture?: string;
  onLog?: (message: string) => void;
};

/**
 * A dev-only path for exercising the complete caption-only renderer handoff.
 * It is fixed to a reserved .invalid URL and reads deterministic local files;
 * packaged builds and every other URL always return null.
 */
export async function loadDevelopmentCaptionRecoveryFixture({
  url,
  isPackaged,
  appPath,
  outputDir,
  enabledFixture,
  onLog,
}: Options): Promise<AutomaticCaptionRecoveryResult | null> {
  if (
    isPackaged ||
    enabledFixture !== DEVELOPMENT_CAPTION_RECOVERY_FIXTURE ||
    url !== DEVELOPMENT_CAPTION_RECOVERY_URL
  ) {
    return null;
  }

  const fixtureDir =
    path.basename(appPath) === 'main' &&
    path.basename(path.dirname(appPath)) === 'packages'
      ? path.join(
          appPath,
          'tests',
          'fixtures',
          DEVELOPMENT_CAPTION_RECOVERY_FIXTURE
        )
      : path.join(
          appPath,
          'packages',
          'main',
          'tests',
          'fixtures',
          DEVELOPMENT_CAPTION_RECOVERY_FIXTURE
        );
  const [downloadError, infoJson, subtitles] = await Promise.all([
    fsp.readFile(path.join(fixtureDir, 'download-error.txt'), 'utf8'),
    fsp.readFile(path.join(fixtureDir, 'info.json'), 'utf8'),
    fsp.readFile(path.join(fixtureDir, 'captions.en-orig.srt'), 'utf8'),
  ]);
  const failure = classifyUrlDownloadFailureDetail(new Error(downloadError));
  if (!failure.canAttemptPublicAutomaticCaptions) {
    throw new Error('Development fixture is not a recoverable media 403.');
  }

  const filePrefix = 'development_caption_recovery_';
  await fsp.mkdir(outputDir, { recursive: true });
  onLog?.('Using local development caption-recovery fixture.');
  return recoverPublicYouTubeAutomaticCaptions({
    url,
    outputDir,
    filePrefix,
    ffmpegPath: 'fixture-ffmpeg',
    runYtDlp: async args => {
      if (args.includes('--dump-single-json')) {
        return { stdout: infoJson };
      }
      await fsp.writeFile(
        path.join(outputDir, `${filePrefix}fixture.en-orig.srt`),
        subtitles,
        'utf8'
      );
      return { stdout: '' };
    },
    onLog,
  });
}
