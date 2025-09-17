import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';
import { FileManager } from './file-manager.js';
import type { FFmpegContext } from './ffmpeg-runner.js';
import type {
  DubSegmentPayload,
  GenerateProgressCallback,
} from '@shared-types/app';
import { synthesizeDub } from './stage5-client.js';

interface GenerateDubArgs {
  segments: DubSegmentPayload[];
  videoPath?: string | null;
  voice?: string;
  quality?: 'standard' | 'high';
  operationId: string;
  signal: AbortSignal;
  progressCallback?: GenerateProgressCallback;
  fileManager: FileManager;
  ffmpeg: FFmpegContext;
}

export async function generateDubbedMedia({
  segments,
  videoPath,
  voice,
  quality,
  operationId,
  signal,
  progressCallback,
  fileManager,
  ffmpeg,
}: GenerateDubArgs): Promise<{
  audioPath: string;
  videoPath?: string;
}> {
  if (!segments?.length) {
    throw new Error('No subtitle segments provided for dubbing.');
  }
  log.info(
    `[${operationId}] Generating dub audio (${segments.length} segments) voice=${
      voice || 'default'
    } quality=${quality || 'standard'}`
  );

  const payloadSegments = segments.map(seg => ({
    start: typeof seg.start === 'number' ? seg.start : undefined,
    end: typeof seg.end === 'number' ? seg.end : undefined,
    original: seg.original ?? '',
    translation: seg.translation ?? '',
    index: typeof seg.index === 'number' ? seg.index : undefined,
    targetDuration:
      typeof seg.targetDuration === 'number' && seg.targetDuration > 0
        ? seg.targetDuration
        : typeof seg.start === 'number' && typeof seg.end === 'number'
          ? Math.max(0, seg.end - seg.start)
          : undefined,
  }));

  progressCallback?.({
    percent: Math.min(30, Math.max(20, payloadSegments.length / 2 + 20)),
    stage: `Preparing ${payloadSegments.length} segments for dubbing...`,
    operationId,
  });

  progressCallback?.({
    percent: 35,
    stage: `Requesting voice synthesis (0/${payloadSegments.length})...`,
    operationId,
  });

  const batchSize = Math.max(
    1,
    Math.min(20, Math.ceil(payloadSegments.length / 10))
  );
  const batchCount = Math.max(1, Math.ceil(payloadSegments.length / batchSize));
  const aggregatedClips: {
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }[] = [];
  let voiceUsed: string | undefined;
  let modelUsed: string | undefined;
  let formatUsed = 'mp3';

  try {
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const start = batchIndex * batchSize;
      const batchSegments = payloadSegments.slice(start, start + batchSize);
      const percentBase = 35;
      const percentRange = 9;
      progressCallback?.({
        percent: Math.min(
          44,
          percentBase + (percentRange * batchIndex) / Math.max(1, batchCount)
        ),
        stage: `Requesting voice synthesis (${start + 1}-${Math.min(
          payloadSegments.length,
          start + batchSegments.length
        )}/${payloadSegments.length})...`,
        operationId,
      });

      const result = await synthesizeDub({
        segments: batchSegments,
        voice,
        quality: 'standard',
        signal,
      });

      if (result?.segments?.length) {
        aggregatedClips.push(...result.segments);
      }
      formatUsed = result?.format ?? formatUsed;
      voiceUsed = result?.voice ?? voiceUsed;
      modelUsed = result?.model ?? modelUsed;

      progressCallback?.({
        percent: Math.min(
          44,
          percentBase +
            (percentRange * (batchIndex + 1)) / Math.max(1, batchCount)
        ),
        stage: `Requesting voice synthesis (${Math.min(
          payloadSegments.length,
          start + batchSegments.length
        )}/${payloadSegments.length})...`,
        operationId,
      });
    }
  } finally {
    // no-op
  }

  const synthResult = {
    audioBase64: undefined,
    format: formatUsed,
    voice: voiceUsed ?? voice ?? 'alloy',
    model: modelUsed ?? 'tts-1',
    segments: aggregatedClips,
    segmentCount: aggregatedClips.length,
  };

  const tmpDir = fileManager.getTempDir();
  try {
    await fileManager.ensureTempDir();
  } catch (err) {
    throw new Error(`Failed to prepare temp directory for dubbing: ${err}`);
  }
  const audioExt = (synthResult.format || 'mp3').replace(/^\.+/, '');
  const hasSegmentClips =
    Array.isArray(synthResult.segments) && synthResult.segments.length > 0;

  let processedAudioPath: string | null = null;

  if (hasSegmentClips) {
    const totalClips = synthResult.segments?.length ?? 0;
    progressCallback?.({
      percent: 45,
      stage: totalClips
        ? `Aligning voice segments 0/${totalClips}...`
        : 'Aligning dub segments with original timing...',
      operationId,
    });

    const payloadByIndex = new Map<number, (typeof payloadSegments)[number]>();
    payloadSegments.forEach(seg => {
      if (typeof seg.index === 'number' && Number.isFinite(seg.index)) {
        payloadByIndex.set(seg.index, seg);
      }
    });

    const preparedSegments: Array<{
      path: string;
      start: number;
      duration: number;
    }> = [];
    const tempSegmentPaths: Set<string> = new Set();
    let fallbackStart = 0;

    const clipCount = synthResult.segments?.length ?? 0;
    for (let clipIdx = 0; clipIdx < clipCount; clipIdx++) {
      const clip = synthResult.segments![clipIdx];
      if (signal.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const targetIndex = Number.isFinite(clip?.index)
        ? Number(clip.index)
        : null;
      const meta =
        targetIndex != null ? payloadByIndex.get(targetIndex) : undefined;

      if (!clip?.audioBase64) {
        log.warn(
          `[${operationId}] Missing audio payload for segment ${targetIndex ?? clipIdx + 1}, skipping.`
        );
        continue;
      }

      const baseName = `dub-seg-${operationId}-${targetIndex ?? preparedSegments.length}-${Date.now()}.${audioExt}`;
      const basePath = path.join(tmpDir, baseName);
      try {
        const baseBuffer = Buffer.from(clip.audioBase64, 'base64');
        await fs.writeFile(basePath, baseBuffer);
      } catch (writeErr) {
        throw new Error(
          `[${operationId}] Failed to write temp audio segment at ${basePath}: ${writeErr}`
        );
      }
      tempSegmentPaths.add(basePath);

      let finalPath = basePath;
      let actualDuration = 0;
      try {
        actualDuration = await ffmpeg.getMediaDuration(finalPath);
      } catch (durationErr) {
        log.warn(
          `[${operationId}] Unable to measure duration for segment ${targetIndex ?? 'unknown'}:`,
          durationErr
        );
      }

      const fallbackDuration =
        typeof meta?.end === 'number' && typeof meta?.start === 'number'
          ? Math.max(0, meta.end - meta.start)
          : undefined;
      const targetDuration =
        typeof clip?.targetDuration === 'number' && clip.targetDuration > 0
          ? clip.targetDuration
          : fallbackDuration;

      if (
        targetDuration &&
        targetDuration > 0.05 &&
        actualDuration &&
        actualDuration > targetDuration &&
        Math.abs(actualDuration - targetDuration) / targetDuration > 0.05
      ) {
        const factor = actualDuration / targetDuration;
        const atempoFilters = buildAtempoFilters(factor);
        if (atempoFilters) {
          const stretchedPath = path.join(
            tmpDir,
            `dub-seg-stretched-${operationId}-${targetIndex ?? 'unknown'}-${Date.now()}.${audioExt}`
          );
          try {
            await ffmpeg.run(
              [
                '-y',
                '-i',
                finalPath,
                '-filter:a',
                atempoFilters,
                stretchedPath,
              ],
              { operationId, signal }
            );
            finalPath = stretchedPath;
            tempSegmentPaths.add(stretchedPath);
            actualDuration = targetDuration;
          } catch (stretchErr) {
            log.warn(
              `[${operationId}] Failed to retime segment ${targetIndex ?? 'unknown'} (factor=${factor.toFixed(3)}):`,
              stretchErr
            );
          }
        }
      }

      const start =
        typeof meta?.start === 'number' && Number.isFinite(meta.start)
          ? meta.start
          : fallbackStart;
      const duration =
        targetDuration && targetDuration > 0.01
          ? targetDuration
          : actualDuration && actualDuration > 0.01
            ? actualDuration
            : 0;

      preparedSegments.push({
        path: finalPath,
        start: Math.max(0, start),
        duration,
      });

      fallbackStart = Math.max(fallbackStart, start + duration);

      if (totalClips > 0) {
        const alignPercent =
          45 + Math.min(13, (13 * (clipIdx + 1)) / totalClips);
        progressCallback?.({
          percent: Math.min(58, alignPercent),
          stage: `Aligning voice segments ${clipIdx + 1}/${totalClips}...`,
          operationId,
        });
      }
    }

    preparedSegments.sort((a, b) => a.start - b.start);

    if (preparedSegments.length > 0) {
      const timelineDurationCandidates = preparedSegments.map(
        seg => seg.start + seg.duration
      );
      const timelineDuration = Math.max(
        ...timelineDurationCandidates,
        fallbackStart,
        0
      );

      const combineArgs = ['-y'];
      preparedSegments.forEach(seg => {
        combineArgs.push('-i', seg.path);
      });

      const totalDuration =
        Number.isFinite(timelineDuration) && timelineDuration > 0
          ? timelineDuration
          : preparedSegments.reduce(
              (sum, seg) => sum + Math.max(0, seg.duration),
              0
            );

      const filterParts = preparedSegments.map((seg, idx) => {
        const delayMs = Math.max(0, Math.round(seg.start * 1000));
        const label = `seg${idx}`;
        const durationPart =
          totalDuration && Number.isFinite(totalDuration)
            ? `,atrim=0:${totalDuration.toFixed(3)}`
            : '';
        return `[${idx}:a]adelay=${delayMs}|${delayMs},apad${durationPart},asetpts=N/SR/TB[${label}]`;
      });

      let filterComplex: string;
      if (preparedSegments.length === 1) {
        filterComplex = filterParts[0].replace('[seg0]', '[voice]');
      } else {
        const mixInputs = preparedSegments
          .map((_, idx) => `[seg${idx}]`)
          .join('');
        filterComplex = `${filterParts.join(';')};${mixInputs}amix=inputs=${preparedSegments.length}:dropout_transition=0:normalize=0[voice]`;
      }

      const voiceTrackPath = path.join(
        tmpDir,
        `dub-segments-${operationId}-${Date.now()}.${audioExt}`
      );

      combineArgs.push(
        '-filter_complex',
        filterComplex,
        '-map',
        '[voice]',
        '-ac',
        '1'
      );

      if (audioExt === 'wav') {
        combineArgs.push('-c:a', 'pcm_s16le');
      } else if (audioExt === 'aac' || audioExt === 'm4a') {
        combineArgs.push('-c:a', 'aac', '-b:a', '192k');
      } else {
        combineArgs.push('-c:a', 'libmp3lame', '-b:a', '192k');
      }

      combineArgs.push(voiceTrackPath);

      await ffmpeg.run(combineArgs, { operationId, signal });
      processedAudioPath = voiceTrackPath;

      for (const pathToRemove of tempSegmentPaths) {
        if (pathToRemove !== voiceTrackPath) {
          try {
            await fs.unlink(pathToRemove);
          } catch (cleanupErr) {
            log.warn(
              `[${operationId}] Failed to remove temp segment ${pathToRemove}:`,
              cleanupErr
            );
          }
        }
      }

      progressCallback?.({
        percent: 58,
        stage: 'Merged dub segments into continuous track',
        operationId,
      });
    } else {
      log.warn(
        `[${operationId}] No segments produced for dubbing; falling back to combined audio.`
      );
    }
  }

  if (!processedAudioPath && synthResult.audioBase64) {
    const audioPath = path.join(
      tmpDir,
      `dub-${operationId}-${Date.now()}.${audioExt}`
    );
    await fs.writeFile(
      audioPath,
      Buffer.from(synthResult.audioBase64, 'base64')
    );
    processedAudioPath = audioPath;
  }

  if (!processedAudioPath) {
    throw new Error('Failed to prepare dubbed audio track.');
  }

  if (videoPath) {
    try {
      const originalDuration = await ffmpeg.getMediaDuration(videoPath);
      const dubbingDuration = await ffmpeg.getMediaDuration(processedAudioPath);

      if (
        Number.isFinite(originalDuration) &&
        Number.isFinite(dubbingDuration) &&
        originalDuration > 0 &&
        dubbingDuration > originalDuration
      ) {
        const factor = dubbingDuration / originalDuration;
        const drift =
          Math.abs(dubbingDuration - originalDuration) / originalDuration;
        if (drift > 0.03 && Number.isFinite(factor)) {
          const stretchedPath = path.join(
            tmpDir,
            `dub-stretched-${operationId}-${Date.now()}.${audioExt}`
          );
          const atempoFilters = buildAtempoFilters(factor);
          if (atempoFilters) {
            try {
              const previousVoicePath = processedAudioPath;
              await ffmpeg.run(
                [
                  '-y',
                  '-i',
                  processedAudioPath,
                  '-filter:a',
                  atempoFilters,
                  stretchedPath,
                ],
                { operationId, signal }
              );
              processedAudioPath = stretchedPath;
              if (previousVoicePath && previousVoicePath !== stretchedPath) {
                try {
                  await fs.unlink(previousVoicePath);
                } catch (cleanupErr) {
                  log.warn(
                    `[${operationId}] Failed to remove intermediate dub file ${previousVoicePath}:`,
                    cleanupErr
                  );
                }
              }
            } catch (err) {
              log.warn(
                `[${operationId}] Failed to stretch final dub audio (factor=${factor.toFixed(3)}):`,
                err
              );
            }
          }
        }
      }
    } catch (err) {
      log.warn(
        `[${operationId}] Unable to analyze dub durations for retiming`,
        err
      );
    }
  }

  progressCallback?.({
    percent: videoPath ? 75 : 95,
    stage: 'Prepared dubbed audio track',
    operationId,
  });

  if (!videoPath) {
    progressCallback?.({
      percent: 100,
      stage: 'Dub audio ready',
      operationId,
    });
    return { audioPath: processedAudioPath };
  }

  const outputPath = path.join(
    tmpDir,
    `dubbed-${operationId}-${Date.now()}.mp4`
  );

  try {
    progressCallback?.({
      percent: 85,
      stage: 'Balancing audio tracks...',
      operationId,
    });

    const backgroundVolume = voice ? 0.25 : 0.35;
    const voiceVolume = 1.0;
    const filterComplex =
      `[0:a]volume=${backgroundVolume.toFixed(2)},equalizer=f=1500:width_type=q:width=1.0:g=-12[bg];` +
      `[1:a]volume=${voiceVolume.toFixed(2)},adelay=0|0[voice];` +
      `[bg][voice]amix=inputs=2:dropout_transition=0:normalize=0[aout]`;

    await ffmpeg.run(
      [
        '-y',
        '-i',
        videoPath,
        '-i',
        processedAudioPath,
        '-filter_complex',
        filterComplex,
        '-map',
        '0:v:0',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-shortest',
        outputPath,
      ],
      { operationId, signal }
    );
  } catch (err: any) {
    log.error(`[${operationId}] Failed to mux dubbed audio with video:`, err);
    throw new Error(
      err?.message || 'Failed to combine dubbed audio with video.'
    );
  }

  progressCallback?.({
    percent: 100,
    stage: 'Dubbed video ready',
    operationId,
  });

  return { audioPath: processedAudioPath, videoPath: outputPath };
}

function buildAtempoFilters(ratio: number): string | null {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }

  const filters: number[] = [];
  let remaining = ratio;

  while (remaining > 2.0) {
    filters.push(2.0);
    remaining = remaining / 2.0;
  }

  while (remaining < 0.5) {
    filters.push(0.5);
    remaining = remaining * 2.0;
  }

  if (Math.abs(remaining - 1) > 0.02) {
    filters.push(Number(remaining.toFixed(3)));
  }

  if (filters.length === 0) {
    return null;
  }

  return filters.map(v => `atempo=${v}`).join(',');
}
