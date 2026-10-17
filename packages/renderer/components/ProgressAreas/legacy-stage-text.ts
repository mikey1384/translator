import type { TFunction } from 'i18next';

/**
 * The main process still reports some progress as plain English sentences.
 * This turns each known one into a translated line (numbers kept), so a
 * Korean or German user never sees an English status pop up. Anything not
 * listed passes through unchanged.
 */

type Literal = { key: string; en: string };

const norm = (text: string) =>
  text.trim().replace(/…/g, '...').replace(/\.+$/, '').toLowerCase();

const LITERALS: Record<string, Literal> = Object.fromEntries(
  (
    [
      ['Analyzing video file', 'analyzingVideo', 'Checking the video…'],
      [
        'Applying final adjustments',
        'finalAdjustments',
        'Applying final touches…',
      ],
      [
        'Assembling subtitle overlay video',
        'assemblingOverlay',
        'Drawing the subtitles onto the video…',
      ],
      ['Audio extraction complete', 'audioExtracted', 'Audio ready'],
      [
        'Automatic captions ready; video remains unavailable',
        'captionsOnlyReady',
        'YouTube captions ready (the video itself couldn’t be downloaded)',
      ],
      [
        'Balancing audio tracks',
        'balancingAudio',
        'Balancing voice and background…',
      ],
      [
        'Cannot cancel during final save',
        'cannotCancelSave',
        'Almost done. This last save can’t be cancelled',
      ],
      ['Checking JS runtime', 'checkingDownloader', 'Checking the downloader…'],
      [
        'Choose where to save the video',
        'chooseSaveLocation',
        'Choose where to save the video…',
      ],
      [
        'Detecting speech segments',
        'detectingSpeech',
        'Finding where people speak…',
      ],
      ['Download cancelled', 'downloadCancelled', 'Download cancelled'],
      [
        'Download complete, verifying',
        'downloadVerifying',
        'Downloaded, checking the file…',
      ],
      ['Download complete', 'downloadComplete', 'Download complete'],
      [
        'Downloading yt-dlp',
        'settingUpDownloader',
        'Setting up the downloader…',
      ],
      [
        'Installing yt-dlp',
        'settingUpDownloader',
        'Setting up the downloader…',
      ],
      [
        'Preparing yt-dlp install',
        'settingUpDownloader',
        'Setting up the downloader…',
      ],
      ['Verifying yt-dlp', 'settingUpDownloader', 'Setting up the downloader…'],
      [
        'Making binary executable',
        'settingUpDownloader',
        'Setting up the downloader…',
      ],
      ['Dub audio ready', 'dubAudioReady', 'Voice track ready'],
      ['Dub generation complete', 'dubComplete', 'Dubbing complete'],
      ['Dubbed video ready', 'dubbedVideoReady', 'Dubbed video ready'],
      ['Encoding complete!', 'encodingComplete', 'Video ready'],
      ['Encoding video', 'encodingVideo', 'Making the video…'],
      ['Error recovery pass', 'errorRecovery', 'Fixing a few lines…'],
      ['Extracting audio segment', 'extractingAudio', 'Extracting audio…'],
      ['Starting audio extraction', 'extractingAudio', 'Extracting audio…'],
      ['Fetching video info', 'fetchingInfo', 'Getting video details…'],
      ['Finalising container', 'finishingFile', 'Finishing the video file…'],
      [
        'Finalizing subtitles',
        'finalizingSubtitles',
        'Finishing the subtitles…',
      ],
      ['Initializing', 'starting', 'Starting…'],
      ['Starting subtitle generation', 'starting', 'Starting…'],
      ['Starting download', 'startingDownload', 'Starting download…'],
      ['Merge complete!', 'mergeComplete', 'Video with subtitles is ready'],
      ['Merge failed', 'mergeFailed', 'Making the video failed'],
      [
        'Merged dub segments into continuous track',
        'voiceTrackAssembled',
        'Voice track assembled',
      ],
      ['Merging formats', 'mergingFormats', 'Joining video and audio…'],
      ['Overlay concat ready', 'subtitleLayerReady', 'Subtitle layer ready'],
      ['Post-processing', 'postProcessing', 'Finishing up…'],
      ['Prepared dubbed audio track', 'voiceTrackReady', 'Voice track ready'],
      ['Preparing download', 'preparingDownload', 'Preparing download…'],
      [
        'Preparing highlight selection',
        'preparingHighlights',
        'Getting ready to pick highlights…',
      ],
      [
        'Preparing output directory',
        'preparingOutput',
        'Preparing the output folder…',
      ],
      [
        'Preparing transcript slices',
        'preparingTranscript',
        'Reading the transcript…',
      ],
      [
        'Preparing video engine',
        'preparingVideoEngine',
        'Getting the video tools ready…',
      ],
      [
        'Rate limited, retrying',
        'rateLimited',
        'Busy right now, trying again…',
      ],
      [
        'Reusing summary sections for highlight selection',
        'reusingSummary',
        'Using the summary to pick highlights…',
      ],
      ['Saving', 'saving', 'Saving…'],
      [
        'Skipping translation (same language)',
        'skippingSameLanguage',
        'Already in this language, no translation needed',
      ],
      ['Summary ready', 'summaryReady', 'Summary ready'],
      [
        'Synthesizing comprehensive summary',
        'writingSummary',
        'Writing the summary…',
      ],
      ['Validating', 'validating', 'Checking…'],
      [
        'Video blocked; checking public automatic captions',
        'videoBlockedCaptions',
        'The video couldn’t be downloaded; checking for YouTube captions instead…',
      ],
      [
        'Transcription complete!',
        'transcriptionComplete',
        'Transcription complete',
      ],
      ['Uploading', 'uploading', 'Uploading…'],
      // Bare status words from main and the renderer itself.
      ['Starting', 'starting', 'Starting…'],
      ['Completed', 'completed', 'Done'],
      ['Cancelled', 'cancelled', 'Cancelled'],
      ['Canceled', 'cancelled', 'Cancelled'],
      ['Process cancelled', 'cancelled', 'Cancelled'],
      ['Cancelling', 'cancelling', 'Cancelling…'],
      ['Failed', 'failed', 'Something went wrong'],
      ['Error', 'failed', 'Something went wrong'],
      ['Downloading', 'downloading', 'Downloading…'],
      ['Downloading audio', 'downloadingAudio', 'Downloading audio…'],
      [
        'Transcribing subtitle cue',
        'transcribingLine',
        'Transcribing the line…',
      ],
      ['Starting merge', 'startingExport', 'Starting the video…'],
      ['yt-dlp ready', 'checkingDownloader', 'Checking the downloader…'],
      [
        'Video blocked; automatic captions available',
        'captionsAvailable',
        'The video couldn’t be downloaded, but YouTube captions are available',
      ],
      [
        'Automatic captions ready; not opened',
        'captionsNotOpened',
        'YouTube captions are ready but weren’t opened',
      ],
    ] as const
  ).map(([text, key, en]) => [norm(text), { key, en }])
);

type Pattern = {
  re: RegExp;
  key: string;
  en: string;
  vars: string[];
};

const PATTERNS: Pattern[] = [
  {
    re: /^Aligning voice segments (\d+)\/(\d+)/i,
    key: 'aligningVoices',
    en: 'Lining up voices {{done}}/{{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Analyzing section (\d+) of (\d+) for highlights/i,
    key: 'analyzingSection',
    en: 'Looking for highlights in part {{done}} of {{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Capturing PNGs… \((\d+)\/(\d+)\)/i,
    key: 'drawingFrames',
    en: 'Drawing subtitle frames {{done}}/{{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Extracting audio \(([\d.]+)%\)/i,
    key: 'extractingAudioPercent',
    en: 'Extracting audio ({{percent}}%)…',
    vars: ['percent'],
  },
  {
    re: /^Preparing (\d+) segments for dubbing/i,
    key: 'preparingDubLines',
    en: 'Preparing {{count}} lines for dubbing…',
    vars: ['count'],
  },
  {
    re: /^Preparing (\d+) voice clips/i,
    key: 'preparingVoiceClips',
    en: 'Preparing {{count}} voice clips…',
    vars: ['count'],
  },
  {
    re: /^Preparing audio extraction for ([\d.]+) MB video \(([\d.]+) min\)/i,
    key: 'preparingAudioExtraction',
    en: 'Preparing the audio ({{minutes}} min of video)…',
    vars: ['size', 'minutes'],
  },
  {
    re: /^Requesting voice synthesis \((\d+)\/(\d+)\)/i,
    key: 'generatingVoices',
    en: 'Generating voices {{done}}/{{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Section (\d+) analyzed/i,
    key: 'sectionAnalyzed',
    en: 'Part {{done}} checked',
    vars: ['done'],
  },
  {
    re: /^Section (\d+) highlights proposed/i,
    key: 'sectionHighlights',
    en: 'Highlights found in part {{done}}',
    vars: ['done'],
  },
  {
    re: /^Section (\d+) of (\d+) summarized/i,
    key: 'sectionSummarized',
    en: 'Part {{done}} of {{total}} summarized',
    vars: ['done', 'total'],
  },
  {
    re: /^Selecting highlights section (\d+) of (\d+)/i,
    key: 'selectingHighlights',
    en: 'Picking highlights in part {{done}} of {{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Summarizing section (\d+) of (\d+)/i,
    key: 'summarizingSection',
    en: 'Summarizing part {{done}} of {{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Translating (\d+)\/(\d+)/i,
    key: 'translatingLines',
    en: 'Translating {{done}}/{{total}}…',
    vars: ['done', 'total'],
  },
  {
    re: /^Transcribing (\d+)\/(\d+)/i,
    key: 'transcribingParts',
    en: 'Transcribing {{done}}/{{total}}…',
    vars: ['done', 'total'],
  },
];

// Final-state tokens any task can end with. Task-specific tokens are left
// to the stage-label helpers.
const FINAL_TOKENS: Record<string, Literal> = {
  completed: { key: 'completed', en: 'Done' },
  process_cancelled: { key: 'cancelled', en: 'Cancelled' },
  error: { key: 'failed', en: 'Something went wrong' },
  insufficient_credits: {
    key: 'insufficientCredits',
    en: 'Not enough credits',
  },
  starting: { key: 'starting', en: 'Starting…' },
};

/** English source strings, for en.json and the locale tests. */
export const LEGACY_STAGE_EN: Record<string, string> = Object.fromEntries([
  ...Object.values(LITERALS).map(l => [l.key, l.en]),
  ...Object.values(FINAL_TOKENS).map(l => [l.key, l.en]),
  ...PATTERNS.map(p => [p.key, p.en]),
]);

export function localizeLegacyStage(stage: string, t: TFunction): string {
  if (!stage) return stage;
  if (stage.startsWith('__i18n__:')) {
    const token = FINAL_TOKENS[stage.slice(9)];
    return token ? t(`progress.legacy.${token.key}`, token.en) : stage;
  }
  // "Error: <English detail>" from older main code: the detail stays in logs.
  if (/^error:\s/i.test(stage.trim())) {
    return t('progress.legacy.failed', 'Something went wrong');
  }
  const literal = LITERALS[norm(stage)];
  if (literal) return t(`progress.legacy.${literal.key}`, literal.en);
  for (const p of PATTERNS) {
    const match = stage.match(p.re);
    if (!match) continue;
    // Numbers stay numbers so they read in the UI language's digits and
    // `count` picks the right plural form.
    const values: Record<string, string | number> = {};
    p.vars.forEach((name, i) => {
      const raw = match[i + 1];
      values[name] = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    });
    return t(`progress.legacy.${p.key}`, { defaultValue: p.en, ...values });
  }
  return stage;
}
