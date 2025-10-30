import path from 'path';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { ChildProcess } from 'child_process';
import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import log from 'electron-log';
import { pathToFileURL } from 'url';

import { RenderSubtitlesOptions } from '@shared-types/app';
import type { FFmpegContext } from '../../services/ffmpeg-runner.js';
import { getAssetsPath } from '../../../shared/helpers/paths.js';
import {
  registerAutoCancel,
  registerRenderJob,
  cancel as registryCancel,
} from '../../active-processes.js';

import { createOperationTempDir, cleanupTempDir } from './temp-utils.js';
import { initPuppeteer } from './puppeteer-setup.js';
import { generateSubtitleEvents } from './srt-parser.js';
import {
  DEFAULT_STYLIZED_CAPTION_STYLE,
  createAssFromSegments,
} from '../../services/highlight-stylizer.js';
import { computeTranslationWordTimings } from '../../services/subtitle-processing/word-timings.js';
import { SUBTITLE_STYLE_PRESETS } from '../../../shared/constants/subtitle-styles.js';
import { parseSrt, buildSrt } from '../../../shared/helpers/index.js';
import { normalizeSubtitleSegments } from '../../services/subtitle-processing/pipeline/finalize-pass.js';
import { generateStatePngs } from './state-generator.js';
import { directMerge } from './ffmpeg-direct-merge.js';
import { probeFps } from './ffprobe-utils.js';

const activeRenderJobs = new Map<
  string,
  { browser?: import('puppeteer').Browser; processes: ChildProcess[] }
>();
export const getActiveRenderJob = (id: string) => activeRenderJobs.get(id);

const jobControllers = new Map<string, AbortController>();

const fontRegular = pathToFileURL(getAssetsPath('NotoSans-Regular.ttf')).href;

export function initializeRenderWindowHandlers({
  ffmpeg,
}: {
  ffmpeg: FFmpegContext;
}): void {
  log.info('[RenderWindowHandlers] Initialising …');

  async function makeBlackVideo({
    out,
    w,
    h,
    fps,
    dur,
  }: {
    out: string;
    w: number;
    h: number;
    fps: number;
    dur: number;
  }) {
    await ffmpeg.run(
      [
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${w}x${h}:r=${fps}`,
        '-t',
        String(dur),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-an',
        out,
      ],
      { operationId: 'makeBlackVideo' }
    );
  }

  function assToRgbaHex(ass: string): string {
    const m = ass.match(/&H([0-9A-Fa-f]{8})/);
    const raw = (m ? m[1] : '').toUpperCase();
    if (raw.length !== 8) return '#FFFFFF';
    const aa = raw.slice(0, 2);
    const bb = raw.slice(2, 4);
    const gg = raw.slice(4, 6);
    const rr = raw.slice(6, 8);
    return `#${aa}${rr}${gg}${bb}`;
  }

  function styleFromPreset(
    presetKey: keyof typeof SUBTITLE_STYLE_PRESETS,
    fontSizePx: number
  ) {
    const preset =
      SUBTITLE_STYLE_PRESETS[presetKey] || SUBTITLE_STYLE_PRESETS.Default;
    const size = Math.max(8, Math.round(fontSizePx || 24));
    return {
      id: preset.name,
      fontFamily: preset.fontName,
      fontSize: size,
      primaryColor: assToRgbaHex(preset.primaryColor),
      highlightColor: assToRgbaHex(preset.secondaryColor),
      outlineColor: assToRgbaHex(preset.outlineColor),
      backgroundColor: assToRgbaHex(preset.backColor),
      alignment: preset.alignment,
      position: 'bottom' as const,
    };
  }

  ipcMain.on(
    'render-subtitles-request',
    async (event, options: RenderSubtitlesOptions) => {
      const { operationId } = options;
      log.info(
        `[RenderWindowHandlers ${operationId}] render-subtitles-request received`
      );

      const controller = new AbortController();
      jobControllers.set(operationId, controller);

      activeRenderJobs.set(operationId, { processes: [] });

      const renderHandle = {
        processes: [] as ChildProcess[],
        browser: undefined as any,
      };
      registerRenderJob(operationId, renderHandle);

      registerAutoCancel(operationId, event.sender, () =>
        cancelRenderJob(operationId)
      );

      let tempDirPath: string | null = null;
      let browser: import('puppeteer').Browser | null = null;

      const sendProgress = ({
        percent,
        stage,
        error,
      }: {
        percent: number;
        stage: string;
        error?: string;
      }) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('merge-subtitles-progress', {
            operationId,
            percent,
            stage,
            error,
          });
        }
      };

      const registerProcess = (p: ChildProcess) => {
        activeRenderJobs.get(operationId)?.processes.push(p);
        renderHandle.processes.push(p);
      };

      try {
        // Stylize/ASS path: bypass Puppeteer pipeline and burn ASS directly
        if (options.stylizeKaraoke) {
          try {
            const sj = Array.isArray(options.segmentsJson)
              ? (options.segmentsJson as any[])
              : [];
            const sample = sj.slice(0, 5).map((s, i) => ({
              i: i + 1,
              start: s.start,
              end: s.end,
              hasWords: Array.isArray(s.words) && s.words.length > 0,
              wordsLen: Array.isArray(s.words) ? s.words.length : 0,
              text: String(
                (options.outputMode === 'translation'
                  ? s.translation || s.original || ''
                  : options.outputMode === 'dual'
                    ? `${s.original || ''}${s.translation ? String.fromCharCode(10) + s.translation : ''}`
                    : s.original || s.translation || '') || ''
              )
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 80),
            }));
            const missing = sj.filter(s => {
              const tx = String(
                (options.outputMode === 'translation'
                  ? s.translation || s.original || ''
                  : options.outputMode === 'dual'
                    ? `${s.original || ''}${s.translation ? String.fromCharCode(10) + s.translation : ''}`
                    : s.original || s.translation || '') || ''
              )
                .replace(/\s+/g, ' ')
                .trim();
              return tx.length > 0 && (!Array.isArray(s.words) || s.words.length === 0);
            }).length;
            log.info(
              `[StylizeDebug] stylizeKaraoke: segmentsJson=${sj.length}, missingWordTimings=${missing}, sampleFirst5=`,
              sample
            );
          } catch (e) {
            log.warn('[StylizeDebug] failed to log segmentsJson sample:', e);
          }
          sendProgress({ percent: 3, stage: 'Preparing stylized subtitles…' });

          const style = options.stylePreset
            ? (styleFromPreset(
                options.stylePreset as any,
                options.fontSizePx || 24
              ) as any)
            : (DEFAULT_STYLIZED_CAPTION_STYLE as any);
          // Build segments from provided JSON (preferred) or from parsed SRT (fallback, no karaoke)
          let segments: Array<{
            start: number;
            end: number;
            text: string;
            words?: Array<{ start: number; end: number; word: string }>;
          }> = [];

          if (
            Array.isArray(options.segmentsJson) &&
            options.segmentsJson.length
          ) {
            const useTranslationOnly = options.outputMode === 'translation';
            const isDual = options.outputMode === 'dual';
            segments = options.segmentsJson.map(s => {
              const start = s.start;
              const end = s.end;
              const textTransOnly = (s.translation || '').trim();
              const text = useTranslationOnly
                ? s.translation || s.original || ''
                : isDual
                  ? `${s.original || ''}${s.translation ? String.fromCharCode(10) + s.translation : ''}`
                  : s.original || s.translation || '';
              const origWords = Array.isArray((s as any).origWords)
                ? (s as any).origWords
                : (Array.isArray((s as any).words) ? (s as any).words : undefined);
              const transWords = Array.isArray((s as any).transWords)
                ? (s as any).transWords
                : undefined;
              // For single-line modes, propagate the active set to `words` for compatibility
              let words: any;
              if (useTranslationOnly) {
                if (textTransOnly.length > 0) {
                  words = transWords as any;
                } else {
                  words = origWords as any;
                }
              } else if (!isDual) {
                words = origWords as any;
              } else {
                words = undefined;
              }
              return {
                start,
                end,
                text,
                words,
                origWords,
                transWords,
                original: s.original ?? '',
                translation: s.translation ?? '',
                _translationTrimmed: textTransOnly,
              } as any;
            });
            {
              const dual = options.outputMode === 'dual';
              const missing = segments.filter(seg => {
                const text = String(seg.text || '').replace(/\s+/g, ' ').trim();
                if (text.length === 0) return false;
                if (dual) {
                  const hasOrig = Array.isArray((seg as any).origWords) && (seg as any).origWords.length > 0;
                  const translationText = String(
                    (seg as any)._translationTrimmed ?? (seg as any).translation ?? ''
                  ).trim();
                  const needsTrans = translationText.length > 0;
                  const hasTrans = Array.isArray((seg as any).transWords) && (seg as any).transWords.length > 0;
                  return !(hasOrig && (!needsTrans || hasTrans));
                } else {
                  if (useTranslationOnly) {
                    const translationText = String(
                      (seg as any)._translationTrimmed ?? (seg as any).translation ?? ''
                    ).trim();
                    if (translationText.length === 0) {
                      const hasOrig = Array.isArray((seg as any).origWords) && (seg as any).origWords.length > 0;
                      return !hasOrig;
                    }
                    const hasT = Array.isArray((seg as any).transWords) && (seg as any).transWords.length > 0;
                    return !hasT;
                  }
                  const hasO = Array.isArray((seg as any).origWords) && (seg as any).origWords.length > 0;
                  return !hasO;
                }
              });
              if (missing.length > 0) {
                const formatTime = (sec: number) => {
                  const clamped = Math.max(0, Number.isFinite(sec) ? sec : 0);
                  const hours = Math.floor(clamped / 3600)
                    .toString()
                    .padStart(2, '0');
                  const minutes = Math.floor((clamped % 3600) / 60)
                    .toString()
                    .padStart(2, '0');
                  const seconds = Math.floor(clamped % 60)
                    .toString()
                    .padStart(2, '0');
                  const millis = Math.floor((clamped % 1) * 1000)
                    .toString()
                    .padStart(3, '0');
                  return `${hours}:${minutes}:${seconds},${millis}`;
                };
                const sample = missing
                  .slice(0, 3)
                  .map(seg =>
                    `${formatTime(seg.start || 0)} "${String(seg.text || '')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 80)}"`
                  )
                  .join('; ');
                throw new Error(
                  `Stylize (word window) requires per-word timings; missing on ${missing.length} segment(s): ${sample || '...'}.`
                );
              }
            }
          } else {
            const parsed = parseSrt(options.srtContent);
            const isDual = options.outputMode === 'dual';
            const useTranslationOnly = options.outputMode === 'translation';
            segments = parsed.map(s => {
              const translationTrimmed = (s.translation || '').trim();
              const text = useTranslationOnly
                ? s.translation || s.original || ''
                : isDual
                  ? `${s.original || ''}${s.translation ? String.fromCharCode(10) + s.translation : ''}`
                  : s.original || s.translation || '';
              const origWords = Array.isArray((s as any).origWords) ? (s as any).origWords : undefined;
              const transWords = Array.isArray((s as any).transWords) ? (s as any).transWords : undefined;
              let words: any;
              if (useTranslationOnly) {
                words = translationTrimmed.length > 0 ? (transWords as any) : (origWords as any);
              } else if (!isDual) {
                words = origWords as any;
              } else {
                words = Array.isArray((s as any).words) ? (s as any).words : undefined;
              }
              return {
                start: s.start,
                end: s.end,
                text,
                words,
                origWords,
                transWords,
                original: s.original ?? '',
                translation: s.translation ?? '',
              };
            });
            {
              const missing = segments.filter(seg => {
                const text = String(seg.text || '').replace(/\s+/g, ' ').trim();
                if (text.length === 0) return false;
                if (isDual) {
                  const hasOrig = Array.isArray((seg as any).origWords) && (seg as any).origWords.length > 0;
                  const translationText = String((seg as any).translation ?? '').trim();
                  const needsTrans = translationText.length > 0;
                  const hasTrans = Array.isArray((seg as any).transWords) && (seg as any).transWords.length > 0;
                  return !(hasOrig && (!needsTrans || hasTrans));
                }
                const translationText = String((seg as any).translation ?? '').trim();
                if (useTranslationOnly && translationText.length === 0) {
                  const hasOrig = Array.isArray((seg as any).origWords) && (seg as any).origWords.length > 0;
                  return !hasOrig;
                }
                const hasWords = Array.isArray(seg.words) && seg.words.length > 0;
                return !hasWords;
              });
              if (missing.length > 0) {
                const sample = missing
                  .slice(0, 3)
                  .map(seg => `${seg.start.toFixed(2)} "${String(seg.text || '')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 80)}"`)
                  .join('; ');
                throw new Error(
                  `Stylize (word window) requires word timings; missing on ${missing.length} segment(s): ${sample || '...'}.`
                );
              }
            }
          }

          const wantVertical = options.stylizeAspect === 'vertical9x16';
          const outW = wantVertical
            ? 1080
            : Math.max(16, Math.floor(options.videoWidth));
          const outH = wantVertical
            ? 1920
            : Math.max(16, Math.floor(options.videoHeight));
          const aspect = Math.max(
            0.01,
            (options.videoWidth || 1280) / Math.max(1, options.videoHeight || 720)
          );
          let resX = outW;
          let resY = outH;
          if (wantVertical) {
            const target = 9 / 16;
            if (aspect > target) {
              resX = 1080;
              resY = Math.max(16, Math.floor(resX / aspect));
            } else {
              resY = 1920;
              resX = Math.max(16, Math.floor(resY * aspect));
            }
          }
          // Pull preset margins to drive exact positioning
          const preset =
            (options.stylePreset &&
              (SUBTITLE_STYLE_PRESETS[options.stylePreset] as any)) ||
            SUBTITLE_STYLE_PRESETS.Default;
          const ass = createAssFromSegments({
            style: style as any,
            segments,
            playResX: resX,
            playResY: resY,
            margins: {
              L: Math.max(0, Math.floor(preset.marginLeft ?? 80)),
              R: Math.max(0, Math.floor(preset.marginRight ?? 80)),
              V: Math.max(0, Math.floor(preset.marginVertical ?? 120)),
            },
            isDual: options.outputMode === 'dual',
            karaoke: true,
          });
          const tempDirPath2 = await createOperationTempDir({ operationId });
          const tempDirReal = await fs.realpath(tempDirPath2);
          tempDirPath = tempDirReal; // store for cleanup
          const assPath = path.join(tempDirReal, `stylize_${operationId}.ass`);
          await fs.writeFile(assPath, ass, 'utf8');
          try {
            await fs.copyFile(assPath, path.join(process.cwd(), 'last-stylize.ass'));
          } catch (e) {
            log.warn(`[${operationId}] Could not copy ASS debug file:`, e);
          }
          try {
            await fs.access(assPath, fsConstants.R_OK);
            const dirEntries = await fs.readdir(tempDirReal);
            const { size } = await fs.stat(assPath);
            const preview = ass.split('\n').slice(0, 5).join(' | ');
            log.info(
              `[RenderWindowHandlers ${operationId}] Temp dir contents after ASS write:`,
              dirEntries,
              `size=${size}`,
              `preview=${preview}`
            );
          } catch (accessErr) {
            log.error(
              `[RenderWindowHandlers ${operationId}] ASS file not readable: ${assPath}`,
              accessErr
            );
          }

          const outTmp = path.join(tempDirReal, `merged_${operationId}.mp4`);

          sendProgress({ percent: 10, stage: 'Rendering stylized subtitles…' });

          const audioOnly = options.overlayMode === 'blackVideo';
          let blackVideoPath = '';
          if (audioOnly) {
            blackVideoPath = path.join(tempDirReal, `black_${operationId}.mp4`);
            await makeBlackVideo({
              out: blackVideoPath,
              w: outW,
              h: outH,
              fps: Math.max(1, Math.floor(options.frameRate || 30)),
              dur: options.videoDuration,
            });
          }

          const escapeForFilter = (p: string) =>
            p
              .replace(/\\/g, '\\\\')
              .replace(/:/g, '\\:')
              .replace(/,/g, '\\,')
              .replace(/ /g, '\\ ')
              .replace(/'/g, "\\'");
          const fontsDir = path.dirname(getAssetsPath('NotoSans-Regular.ttf'));

          const createFilterExpr = (assFile: string) => {
            const assEsc = escapeForFilter(assFile);
            const fontsEsc = escapeForFilter(fontsDir);
            if (wantVertical) {
              const scaleExpr =
                "scale='if(gt(a,0.5625),1080,-2)':'if(gt(a,0.5625),-2,1920)'";
              return (
                `${scaleExpr},` +
                `subtitles=filename=${assEsc}:charenc=UTF-8:fontsdir=${fontsEsc},` +
                `pad=1080:1920:(1080-iw)/2:(1920-ih)/2`
              );
            }
            return `subtitles=filename=${assEsc}:charenc=UTF-8:fontsdir=${fontsEsc}`;
          };

          const filterScriptPath = path.join(tempDirReal, `filter_${operationId}.fg`);

          const runStylize = async (
            assFile: string,
            useFilterScript: boolean
          ) => {
            const expr = createFilterExpr(assFile);
            const filterArgs = useFilterScript
              ? ['-filter_script:v', filterScriptPath]
              : ['-vf', expr];

            if (useFilterScript) {
              await fs.writeFile(filterScriptPath, expr, 'utf8');
            }

            const args = audioOnly
              ? [
                  '-y',
                  '-i',
                  blackVideoPath,
                  '-i',
                  options.originalVideoPath!,
                  ...filterArgs,
                  '-map',
                  '0:v:0',
                  '-map',
                  '1:a:0',
                  '-shortest',
                  '-c:v',
                  'libx264',
                  '-preset',
                  'veryfast',
                  '-crf',
                  '18',
                  '-c:a',
                  'aac',
                  '-b:a',
                  '128k',
                  '-movflags',
                  '+faststart',
                  '-progress',
                  'pipe:1',
                  '-nostats',
                  outTmp,
                ]
              : [
                  '-y',
                  '-i',
                  options.originalVideoPath!,
                  ...filterArgs,
                  '-c:v',
                  'libx264',
                  '-preset',
                  'veryfast',
                  '-crf',
                  '18',
                  '-c:a',
                  'copy',
                  '-movflags',
                  '+faststart',
                  '-progress',
                  'pipe:1',
                  '-nostats',
                  outTmp,
                ];

            await ffmpeg.run(args, {
              operationId,
              totalDuration: options.videoDuration,
              progress: pct =>
                sendProgress({
                  percent: Math.max(10, Math.min(99, Math.round(pct))),
                  stage: 'Rendering stylized subtitles…',
                }),
              signal: controller.signal,
            });
          };

          const tryStylizeWithFallbacks = async () => {
            try {
              await runStylize(assPath, true);
              return;
            } catch (err) {
              log.warn(
                `[RenderWindowHandlers ${operationId}] filter_script stylize failed, retrying with -vf`,
                err
              );
            }

            try {
              await runStylize(assPath, false);
              return;
            } catch (err) {
              log.warn(
                `[RenderWindowHandlers ${operationId}] stylize with quoted -vf failed, retrying with short path`,
                err
              );
            }

            const assShortPath = path.join(tempDirReal, 'subs.ass');
            await fs.writeFile(assShortPath, ass, 'utf8');
            try {
              await fs.access(assShortPath, fsConstants.R_OK);
              const dirEntries = await fs.readdir(tempDirReal);
              const { size } = await fs.stat(assShortPath);
              log.info(
                `[RenderWindowHandlers ${operationId}] Temp dir contents after short ASS write:`,
                dirEntries,
                `size=${size}`
              );
            } catch (accessErr) {
              log.error(
                `[RenderWindowHandlers ${operationId}] Short ASS file not readable: ${assShortPath}`,
                accessErr
              );
            }
            await runStylize(assShortPath, false);
          };

          await tryStylizeWithFallbacks();

          const win = BrowserWindow.getAllWindows()[0];
          if (!win) {
            throw new Error(
              'Cannot show save dialog: No application window found.'
            );
          }
          const suggestedName = `${path.basename(
            options.originalVideoPath!,
            path.extname(options.originalVideoPath!)
          )}-merged.mp4`;

          const { canceled, filePath: userPath } = await dialog.showSaveDialog(
            win,
            {
              title: 'Save Merged Video As',
              defaultPath: suggestedName,
              filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
            }
          );

          if (canceled || !userPath) {
            log.warn(`[${operationId}] User cancelled "save" dialog`);
            await fs.unlink(outTmp).catch(() => void 0);
            event.reply('render-subtitles-result', {
              operationId,
              success: false,
              error: 'Save cancelled by user.',
            });
            return;
          }

          await fs.rename(outTmp, userPath);
          sendProgress({ percent: 100, stage: 'Merge complete!' });
          event.reply('render-subtitles-result', {
            operationId,
            success: true,
            outputPath: userPath,
          });
          return; // stylize path done
        }

        tempDirPath = await createOperationTempDir({ operationId });

        // Guard width/height to ensure they are not zero for audio-only files
        if (!options.videoWidth || options.videoWidth <= 0)
          options.videoWidth = 1280;
        if (!options.videoHeight || options.videoHeight <= 0)
          options.videoHeight = 720;

        const { browser: br, page } = await initPuppeteer({
          operationId,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          fontRegular,
          fontSizePx: options.fontSizePx,
          stylePreset: options.stylePreset,
        });
        browser = br;
        activeRenderJobs.get(operationId)!.browser = browser;
        renderHandle.browser = browser;

        if (!options.originalVideoPath) {
          throw new Error(
            'Original video path is required but was not provided.'
          );
        }

        log.info(
          `[RenderWindowHandlers ${operationId}] Probing FPS for ${options.originalVideoPath}...`
        );
        let realFps = options.frameRate || 30;
        try {
          if (await ffmpeg.hasVideoTrack(options.originalVideoPath)) {
            realFps = await probeFps(
              options.originalVideoPath,
              ffmpeg.ffprobePath
            );
          }
        } catch (err) {
          log.warn(
            `[${operationId}] Could not probe FPS, falling back to ${realFps}`,
            err
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Detected real FPS: ${realFps}`
        );
        options.frameRate = realFps;

        // Finalize subtitles just before render: join <5s gaps and enforce >=3s per cue
        sendProgress({ percent: 5, stage: 'Finalizing subtitles…' });
        const parsedForFinalize = parseSrt(options.srtContent);
        const normalizedSegs = normalizeSubtitleSegments(parsedForFinalize);
        const finalizedSrt = buildSrt({
          segments: normalizedSegs,
          mode: 'dual',
        });

        const uniqueEventsMs = generateSubtitleEvents({
          srtContent: finalizedSrt,
          outputMode: (options.outputMode ?? 'dual') as 'dual' | 'single',
          videoDuration: options.videoDuration,
          operationId,
        });

        const statePngs = await generateStatePngs({
          page,
          events: uniqueEventsMs,
          operationId,
          tempDirPath,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          fps: realFps,
          fontSizePx: options.fontSizePx,
          stylePreset: options.stylePreset,
          progress: sendProgress,
          signal: controller.signal,
        });
        try {
          await page.close();
        } catch {
          /* already closed */
        }

        sendProgress({
          percent: 10,
          stage: 'Assembling subtitle overlay video...',
        });

        const concatListPath = path.join(
          tempDirPath,
          `pngs_${operationId}.txt`
        );
        await writeConcat({ frames: statePngs, listPath: concatListPath });
        sendProgress({ percent: 40, stage: 'Overlay concat ready' });

        let videoForMerge = options.originalVideoPath;
        if (options.overlayMode === 'blackVideo') {
          videoForMerge = path.join(tempDirPath, `black_${operationId}.mp4`);
          await makeBlackVideo({
            out: videoForMerge,
            w: options.videoWidth,
            h: options.videoHeight,
            fps: realFps,
            dur: options.videoDuration,
          });
        }

        const tempMerged = path.join(tempDirPath, `merged_${operationId}.mp4`);
        await directMerge({
          concatListPath,
          baseVideoPath: videoForMerge,
          audioPath:
            options.overlayMode === 'blackVideo'
              ? options.originalVideoPath
              : undefined,
          outputSavePath: tempMerged,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          videoDuration: options.videoDuration,
          operationId,
          ffmpegPath: ffmpeg.ffmpegPath,
          progressCallback: sendProgress,
          registerProcess,
          signal: controller.signal,
        });

        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error(
            'Cannot show save dialog: No application window found.'
          );
        }
        const suggestedName = `${path.basename(
          options.originalVideoPath,
          path.extname(options.originalVideoPath)
        )}-merged.mp4`;

        const { canceled, filePath: userPath } = await dialog.showSaveDialog(
          win,
          {
            title: 'Save Merged Video As',
            defaultPath: suggestedName,
            filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          }
        );

        if (canceled || !userPath) {
          log.warn(`[${operationId}] User cancelled "save" dialog`);
          await fs.unlink(tempMerged).catch(() => void 0);
          event.reply('render-subtitles-result', {
            operationId,
            success: false,
            error: 'Save cancelled by user.',
          });
          return;
        }

        await fs.rename(tempMerged, userPath);
        sendProgress({ percent: 100, stage: 'Merge complete!' });
        event.reply('render-subtitles-result', {
          operationId,
          success: true,
          outputPath: userPath,
        });
      } catch (err: any) {
        log.error(`[RenderWindowHandlers ${operationId}]`, err);
        const errorMessage =
          typeof err === 'string'
            ? err
            : err?.message || err?.error || 'Unknown error';
        if (!event.sender.isDestroyed()) {
          event.reply('render-subtitles-result', {
            operationId,
            success: false,
            error: errorMessage,
          });
        }
      } finally {
        try {
          await browser?.close();
        } catch {
          /* noop */
        }
        await cleanupTempDir({ tempDirPath, operationId });
        activeRenderJobs.delete(operationId);
        jobControllers.delete(operationId);
      }
    }
  );

  ipcMain.on('render-subtitles-cancel', (_event, { operationId }) => {
    cancelRenderJob(operationId);
  });

  // Removed: heavy stylized preview. Using lightweight in-player overlay for DRY.
  /* async function renderStylizedPreview(
    options: Partial<RenderSubtitlesOptions>
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    const operationId =
      options.operationId || `preview-${Date.now().toString(36)}`;
    const wantVertical = options.stylizeAspect === 'vertical9x16';
    const outW = wantVertical
      ? 1080
      : Math.max(16, Math.floor(options.videoWidth || 1280));
    const outH = wantVertical
      ? 1920
      : Math.max(16, Math.floor(options.videoHeight || 720));
    const style = options.stylePreset
      ? (styleFromPreset(
          options.stylePreset as any,
          options.fontSizePx || 24
        ) as any)
      : (DEFAULT_STYLIZED_CAPTION_STYLE as any);

    if (!options.originalVideoPath) {
      throw new Error('Stylize preview requires the original video path.');
    }

    const useTranslationOnly = options.outputMode === 'translation';
    const isDual = options.outputMode === 'dual';

    let segments: Array<{
      start: number;
      end: number;
      text: string;
      words?: Array<{ start: number; end: number; word: string }>;
    }> = [];

    if (Array.isArray(options.segmentsJson) && options.segmentsJson.length) {
      const hasAnyTranslation = options.segmentsJson.some(s =>
        typeof s?.translation === 'string' && s.translation.trim().length > 0
      );
      const hasAnyWords = options.segmentsJson.some(
        s => Array.isArray((s as any)?.words) && (s as any).words.length > 0
      );
      const keepWords = (!useTranslationOnly || !hasAnyTranslation) && hasAnyWords;
      segments = options.segmentsJson.map(s => ({
        start: s.start!,
        end: s.end!,
        text: useTranslationOnly
          ? s.translation || s.original || ''
          : isDual
            ? `${s.original || ''}${s.translation ? String.fromCharCode(10) + s.translation : ''}`
            : s.original || s.translation || '',
        // Keep words when animating (dual/original), and also when no translations exist.
        words: keepWords && Array.isArray(s.words) ? s.words : undefined,
      }));
      // If words are missing while animating, let stylizer approximate timings.
    }

    if (segments.length === 0 && (options.srtContent ?? '').trim().length > 0) {
      const parsed = parseSrt(options.srtContent ?? '');
      const hasAnyTranslation = parsed.some(s =>
        typeof (s as any)?.translation === 'string' && (s as any).translation.trim().length > 0
      );
      const hasAnyWords = parsed.some(
        s => Array.isArray((s as any)?.words) && (s as any).words.length > 0
      );
      const keepWords = !(options.outputMode === 'translation' && hasAnyTranslation) && hasAnyWords;
            segments = parsed.map(s => ({
              start: s.start,
              end: s.end,
              text: useTranslationOnly
                ? s.translation || s.original || ''
                : isDual
                  ? `${s.original || ''}${s.translation ? String.fromCharCode(10) + s.translation : ''}`
                  : s.original || s.translation || '',
              words: keepWords && Array.isArray(s.words) ? s.words : undefined,
            }));
    }

    const preset =
      (options.stylePreset &&
        (SUBTITLE_STYLE_PRESETS[options.stylePreset] as any)) ||
      SUBTITLE_STYLE_PRESETS.Default;
    const aspect = Math.max(
      0.01,
      (options.videoWidth || 1280) / Math.max(1, options.videoHeight || 720)
    );
    let resX = outW;
    let resY = outH;
    if (wantVertical) {
      const target = 9 / 16;
      if (aspect > target) {
        resX = 1080;
        resY = Math.max(16, Math.floor(resX / aspect));
      } else {
        resY = 1920;
        resX = Math.max(16, Math.floor(resY * aspect));
      }
    }

    const ass = createAssFromSegments({
      style,
      segments,
      playResX: resX,
      playResY: resY,
      margins: {
        L: Math.max(0, Math.floor(preset.marginLeft ?? 80)),
        R: Math.max(0, Math.floor(preset.marginRight ?? 80)),
        V: Math.max(0, Math.floor(preset.marginVertical ?? 120)),
      },
      isDual: options.outputMode === 'dual',
      karaoke: true,
    });

    let tempDirPath: string | null = null;
    try {
      tempDirPath = await createOperationTempDir({ operationId });
        const assPath = path.join(tempDirPath, `stylize_${operationId}.ass`);
        await fs.writeFile(assPath, ass, 'utf8');
        try {
          await fs.copyFile(assPath, path.join(process.cwd(), 'last-stylize-preview.ass'));
        } catch (e) {
          log.warn(`[${operationId}] Could not copy preview ASS debug file:`, e);
        }

      const outTmp = path.join(tempDirPath, `preview_${operationId}.mp4`);
      const escapePath = (p: string) =>
        p
          .replace(/\\/g, '\\\\')
          .replace(/:/g, '\\:')
          .replace(/,/g, '\\,')
          .replace(/ /g, '\\ ')
          .replace(/'/g, "\\'");
      const escapedAss = escapePath(assPath);

      const buildVf = (assP: string) =>
        wantVertical
          ? `scale='if(gt(a,0.5625),1080,-2)':'if(gt(a,0.5625),-2,1920)',subtitles=filename=${assP},pad=1080:1920:(1080-iw)/2:(1920-ih)/2`
          : `subtitles=filename=${assP}`;

      let vfPrev = buildVf(escapedAss);
      const audioOnly = options.overlayMode === 'blackVideo';
      let prevArgs: string[];

      if (audioOnly) {
        const blackPath = path.join(tempDirPath, `black_${operationId}.mp4`);
        await makeBlackVideo({
          out: blackPath,
          w: outW,
          h: outH,
          fps: Math.max(1, Math.floor(options.frameRate || 30)),
          dur: options.videoDuration || 5,
        });
        prevArgs = [
          '-y',
          '-i',
          blackPath,
          '-i',
          options.originalVideoPath,
          '-vf',
          vfPrev,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-shortest',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outTmp,
        ];
      } else {
        prevArgs = [
          '-y',
          '-i',
          options.originalVideoPath,
          '-vf',
          vfPrev,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-c:a',
          'copy',
          '-movflags',
          '+faststart',
          outTmp,
        ];
      }

      try {
        const fontsDirPrev = path.dirname(getAssetsPath('NotoSans-Regular.ttf'));
        const esc = escapePath;
        const graphPrev = path.join(tempDirPath, 'graph.fg');
        const graphFilter = wantVertical
          ? `scale='if(gt(a,0.5625),1080,-2)':'if(gt(a,0.5625),-2,1920)',subtitles=filename=${esc(
              assPath
            )}:charenc=UTF-8:fontsdir=${esc(fontsDirPrev)},pad=1080:1920:(1080-iw)/2:(1920-ih)/2`
          : `subtitles=filename=${esc(assPath)}:charenc=UTF-8:fontsdir=${esc(fontsDirPrev)}`;
        await fs.writeFile(graphPrev, graphFilter, 'utf8');

        const fsArgs = audioOnly
          ? [
              '-y',
              '-i',
              prevArgs[2],
              '-i',
              prevArgs[4],
              '-filter_script:v',
              graphPrev,
              '-map',
              '0:v:0',
              '-map',
              '1:a:0',
              '-shortest',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
              outTmp,
            ]
          : [
              '-y',
              '-i',
              prevArgs[2],
              '-filter_script:v',
              graphPrev,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-c:a',
              'copy',
              '-movflags',
              '+faststart',
              outTmp,
            ];
        await ffmpeg.run(fsArgs, { operationId });
      } catch {
        // Retry with raw -vf
        vfPrev = buildVf(escapedAss);
        if (audioOnly) {
          prevArgs = [
            '-y',
            '-i',
            prevArgs[2],
            '-i',
            prevArgs[4],
            '-vf',
            vfPrev,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-shortest',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            outTmp,
          ];
        } else {
          prevArgs = [
            '-y',
            '-i',
            prevArgs[2],
            '-vf',
            vfPrev,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-c:a',
            'copy',
            '-movflags',
            '+faststart',
            outTmp,
          ];
        }
        try {
          await ffmpeg.run(prevArgs, { operationId });
        } catch {
          const shortAss = path.join(tempDirPath, 'subs.ass');
          await fs.writeFile(shortAss, ass, 'utf8');
          const escapedShort = escapePath(shortAss);
          vfPrev = buildVf(escapedShort);
          if (audioOnly) {
            prevArgs = [
              '-y',
              '-i',
              prevArgs[2],
              '-i',
              prevArgs[4],
              '-vf',
              vfPrev,
              '-map',
              '0:v:0',
              '-map',
              '1:a:0',
              '-shortest',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
              outTmp,
            ];
          } else {
            prevArgs = [
              '-y',
              '-i',
              prevArgs[2],
              '-vf',
              vfPrev,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-c:a',
              'copy',
              '-movflags',
              '+faststart',
              outTmp,
            ];
          }
          await ffmpeg.run(prevArgs, { operationId });
        }
      }

      await shell.openPath(outTmp);
      return { success: true, outputPath: outTmp };
    } catch (err: any) {
      const raw = String(err?.message || err || '');
      let hint = 'Stylize preview failed.';
      if (/Unable to open .*\.ass/i.test(raw)) {
        hint = 'Stylize preview failed: could not open generated subtitles file.';
      } else if (/No such filter/i.test(raw)) {
        hint = 'Stylize preview failed: video filter parsing error.';
      } else if (/Invalid data found when processing input/i.test(raw)) {
        hint = 'Stylize preview failed: invalid input or filter chain.';
      }
      return {
        success: false,
        error: `${hint} See Recent Logs for details. (${raw})`,
      };
    } finally {
      // Keep temp dir so the user can replay the preview; OS temp cleanup will handle later
    }
  } */

  // Removed IPC handlers: stylize-merge-preview, stylize-preview

  log.info('[RenderWindowHandlers] IPC handlers ready');
}

function cancelRenderJob(operationId: string) {
  log.warn(`[render-cancel] cancelling ${operationId}`);
  jobControllers.get(operationId)?.abort();
  jobControllers.delete(operationId);
  registryCancel(operationId).catch(err =>
    log.error(`[render-cancel] failed:`, err)
  );
}

async function writeConcat({
  frames,
  listPath,
}: {
  frames: Array<{ path: string; duration: number }>;
  listPath: string;
}) {
  let out = 'ffconcat version 1.0\n\n';
  for (const f of frames) {
    const relativePath = path
      .relative(path.dirname(listPath), f.path)
      .replace(/\\/g, '/');
    out += `file '${relativePath}'\n`;
    out += `duration ${f.duration.toFixed(6)}\n\n`;
  }

  if (frames.length > 0) {
    const lastRelativePath = path
      .relative(path.dirname(listPath), frames.at(-1)!.path)
      .replace(/\\/g, '/');
    out += `file '${lastRelativePath}'\n`;
  }
  await fs.writeFile(listPath, out, 'utf8');
  log.info(`[writeConcat] Wrote PNG concat list to ${listPath}`);
}
