import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';
import { FileManager } from './file-manager.js';
import type { FFmpegContext } from './ffmpeg-runner.js';
import type {
  DubSegmentPayload,
  GenerateProgressCallback,
} from '@shared-types/app';
import {
  synthesizeDub as synthesizeDubAi,
  getActiveProviderForDubbing,
  getCurrentElevenLabsApiKey,
} from './ai-provider.js';
import { dubWithElevenLabs } from './elevenlabs-client.js';

const MIN_DUB_SILENCE_GAP_SEC = 0.15;
// Allow more aggressive compression for ElevenLabs which produces longer audio
const MAX_DUB_COMPRESSION_RATIO = 1.8;
const COMPRESSION_TOLERANCE = 0.05;

interface GenerateDubArgs {
  segments: DubSegmentPayload[];
  videoPath?: string | null;
  voice?: string;
  quality?: 'standard' | 'high';
  ambientMix?: number;
  targetLanguage?: string; // ISO 639-1 code for ElevenLabs Dubbing API
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
  ambientMix,
  targetLanguage,
  operationId,
  signal,
  progressCallback,
  fileManager,
  ffmpeg,
}: GenerateDubArgs): Promise<{
  audioPath: string;
  videoPath?: string;
  transcript?: string; // SRT from ElevenLabs Dubbing API
}> {
  if (!segments?.length) {
    throw new Error('No subtitle segments provided for dubbing.');
  }

  // Check if we should use ElevenLabs Dubbing API (voice cloning)
  const dubbingProvider = getActiveProviderForDubbing();
  const elevenLabsKey = getCurrentElevenLabsApiKey();
  const useElevenLabsDubbing =
    dubbingProvider === 'elevenlabs' &&
    elevenLabsKey &&
    videoPath &&
    targetLanguage;

  if (useElevenLabsDubbing) {
    log.info(
      `[${operationId}] Using ElevenLabs Dubbing API with voice cloning -> ${targetLanguage}`
    );

    try {
      const result = await dubWithElevenLabs({
        filePath: videoPath,
        targetLanguage,
        apiKey: elevenLabsKey,
        signal,
        onProgress: (status, percent) => {
          progressCallback?.({
            percent: percent ?? 50,
            stage: status,
            operationId,
            model: 'ElevenLabs Dubbing',
          });
        },
      });

      // Save the dubbed audio to temp file
      const tmpDir = fileManager.getTempDir();
      await fileManager.ensureTempDir();
      const audioPath = path.join(
        tmpDir,
        `dub-elevenlabs-${operationId}-${Date.now()}.mp3`
      );
      await fs.writeFile(audioPath, Buffer.from(result.audioBase64, 'base64'));

      log.info(`[${operationId}] ElevenLabs dubbing complete: ${audioPath}`);

      // Mix with original video if needed
      if (videoPath) {
        const outputPath = path.join(
          tmpDir,
          `dubbed-${operationId}-${Date.now()}.mp4`
        );

        const mixValueRaw = typeof ambientMix === 'number' ? ambientMix : 0.35;
        const mix = Math.min(1, Math.max(0, mixValueRaw));
        const ambientRatio = mix;
        const voiceRatio = 1 - mix;

        const backgroundVolume =
          ambientRatio > 0.001 ? 0.2 + ambientRatio * 0.35 : 0;
        const voiceVolume = voiceRatio > 0.001 ? 1.25 + voiceRatio * 0.35 : 0;
        const ambientWeight =
          ambientRatio > 0.001 ? (0.5 + ambientRatio) * ambientRatio : 0;
        const voiceWeight = voiceRatio > 0.001 ? 2.0 * voiceRatio : 0;
        const normalize = ambientRatio > 0.001 && voiceRatio > 0.001 ? 1 : 0;

        const filterComplex =
          `[0:a]volume=${backgroundVolume.toFixed(2)}[bg];` +
          `[1:a]volume=${voiceVolume.toFixed(2)}[voice];` +
          `[bg][voice]amix=inputs=2:weights=${ambientWeight.toFixed(3)} ${voiceWeight.toFixed(3)}:dropout_transition=0:normalize=${normalize}[aout]`;

        await ffmpeg.run(
          [
            '-y',
            '-i',
            videoPath,
            '-i',
            audioPath,
            '-filter_complex',
            filterComplex,
            '-map',
            '0:v:0',
            '-map',
            '[aout]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-shortest',
            outputPath,
          ],
          { operationId, signal }
        );

        progressCallback?.({
          percent: 100,
          stage: 'Dubbed video ready (voice cloning)',
          operationId,
          model: 'ElevenLabs Dubbing',
        });

        return {
          audioPath,
          videoPath: outputPath,
          transcript: result.transcript,
        };
      }

      progressCallback?.({
        percent: 100,
        stage: 'Dub audio ready (voice cloning)',
        operationId,
        model: 'ElevenLabs Dubbing',
      });

      return {
        audioPath,
        transcript: result.transcript,
      };
    } catch (err: any) {
      log.error(
        `[${operationId}] ElevenLabs Dubbing API failed, falling back to TTS:`,
        err?.message || err
      );
      // Fall through to TTS-based dubbing
    }
  }

  // TTS-based dubbing (OpenAI or ElevenLabs TTS)
  // For BYO, we know the provider. For Stage5, show generic label until API returns actual model.
  let ttsProvider =
    dubbingProvider === 'elevenlabs'
      ? 'ElevenLabs TTS'
      : dubbingProvider === 'stage5'
        ? 'Stage5 TTS'
        : 'OpenAI TTS';
  log.info(
    `[${operationId}] Generating dub audio (${segments.length} segments) voice=${
      voice || 'default'
    } quality=${quality || 'standard'} provider=${ttsProvider}`
  );

  const originalStartByIndex = new Map<number, number>();

  const payloadSegments = segments.map<DubSegmentPayload>(seg => {
    const start = Number.isFinite(seg.start) ? Number(seg.start) : 0;
    const end = Number.isFinite(seg.end) ? Number(seg.end) : start;
    const rawDuration =
      seg.targetDuration && seg.targetDuration > 0
        ? seg.targetDuration
        : Math.max(0, end - start);
    const duration = Math.max(0.05, rawDuration);
    if (typeof seg.index === 'number' && Number.isFinite(seg.index)) {
      originalStartByIndex.set(seg.index, start);
    }
    return {
      start,
      end: start + duration,
      original: seg.original ?? '',
      translation: seg.translation ?? '',
      index: typeof seg.index === 'number' ? seg.index : undefined,
      targetDuration: duration,
    };
  });

  const payloadByIndex = new Map<number, DubSegmentPayload>();
  const orderedIndexes: number[] = [];
  payloadSegments.forEach(seg => {
    if (typeof seg.index === 'number' && Number.isFinite(seg.index)) {
      payloadByIndex.set(seg.index, seg);
      orderedIndexes.push(seg.index);
    }
  });
  orderedIndexes.sort((a, b) => a - b);

  const durationForPlan = (plan?: DubSegmentPayload | null): number => {
    if (!plan) return 0;
    if (typeof plan.targetDuration === 'number' && plan.targetDuration > 0) {
      return plan.targetDuration;
    }
    const start = Number(plan.start ?? 0);
    const end = Number(plan.end ?? start);
    return Math.max(0, end - start);
  };

  const setPlanDuration = (plan: DubSegmentPayload, duration: number) => {
    const safeDuration = Math.max(0.05, duration);
    plan.targetDuration = safeDuration;
    const start = Number(plan.start ?? 0);
    plan.end = start + safeDuration;
  };

  const getPrevIndex = (idx: number): number | undefined => {
    const pos = orderedIndexes.indexOf(idx);
    return pos > 0 ? orderedIndexes[pos - 1] : undefined;
  };

  const getNextIndex = (idx: number): number | undefined => {
    const pos = orderedIndexes.indexOf(idx);
    return pos >= 0 && pos + 1 < orderedIndexes.length
      ? orderedIndexes[pos + 1]
      : undefined;
  };

  const slideTimelineForward = (idx: number, delta: number): number => {
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    const pos = orderedIndexes.indexOf(idx);
    if (pos === -1) return 0;
    const anchor = payloadByIndex.get(idx);
    if (!anchor) return 0;

    const currentDuration = durationForPlan(anchor);
    setPlanDuration(anchor, currentDuration + delta);

    let carriedShift = delta;
    let prevEnd = Number(anchor.start ?? 0) + durationForPlan(anchor);

    for (let i = pos + 1; i < orderedIndexes.length; i++) {
      const nextIdx = orderedIndexes[i];
      const seg = payloadByIndex.get(nextIdx);
      if (!seg) continue;
      const existingStart = Number(seg.start ?? 0);
      const newStart = existingStart + carriedShift;
      seg.start = newStart;

      const segDuration = durationForPlan(seg);
      if (segDuration > 0) {
        seg.end = newStart + segDuration;
      } else if (typeof seg.end === 'number') {
        seg.end += carriedShift;
      }

      const requiredStart = prevEnd + MIN_DUB_SILENCE_GAP_SEC;
      if (seg.start < requiredStart) {
        const adjust = requiredStart - seg.start;
        seg.start += adjust;
        if (typeof seg.end === 'number') {
          seg.end += adjust;
        }
        carriedShift += adjust;
      }

      prevEnd = Number(seg.start ?? 0) + durationForPlan(seg);
    }

    return delta;
  };

  const extendSegmentAllocation = (idx: number, extra: number): number => {
    if (!Number.isFinite(idx) || !payloadByIndex.has(idx) || extra <= 0) {
      return 0;
    }
    const plan = payloadByIndex.get(idx)!;
    let remaining = extra;
    let gained = 0;

    const baseDuration = durationForPlan(plan);
    let currentDuration = baseDuration;

    const nextIdx = getNextIndex(idx);
    if (nextIdx != null) {
      const nextPlan = payloadByIndex.get(nextIdx);
      if (nextPlan) {
        const gap =
          Number(nextPlan.start ?? 0) -
          (Number(plan.start ?? 0) + currentDuration);
        const available = Math.max(0, gap - MIN_DUB_SILENCE_GAP_SEC);
        const use = Math.min(remaining, available);
        if (use > 0) {
          setPlanDuration(plan, currentDuration + use);
          currentDuration = durationForPlan(plan);
          remaining -= use;
          gained += use;
        }
      }
    }

    if (remaining > 0) {
      const prevIdx = getPrevIndex(idx);
      const prevPlan =
        prevIdx != null ? payloadByIndex.get(prevIdx) : undefined;
      const prevEnd = prevPlan
        ? Number(prevPlan.start ?? 0) + durationForPlan(prevPlan)
        : 0;
      const baseStart =
        originalStartByIndex.get(idx) ?? Number(plan.start ?? 0);
      const minStart = prevPlan
        ? Math.max(prevEnd + MIN_DUB_SILENCE_GAP_SEC, 0)
        : Math.max(baseStart, 0);
      const currentStart = Number(plan.start ?? 0);
      const availableBefore = Math.max(0, currentStart - minStart);
      const useBefore = Math.min(remaining, availableBefore);
      if (useBefore > 0) {
        plan.start = currentStart - useBefore;
        setPlanDuration(plan, currentDuration + useBefore);
        currentDuration = durationForPlan(plan);
        remaining -= useBefore;
        gained += useBefore;
      }
    }

    // DISABLED: Don't shift timeline forward - causes cumulative sync drift
    // Instead, rely on compression (atempo) to fit audio into allocated slots
    // if (remaining > 0) {
    //   const shifted = slideTimelineForward(idx, remaining);
    //   if (shifted > 0) {
    //     gained += shifted;
    //     remaining = Math.max(0, remaining - shifted);
    //   }
    // }

    return gained;
  };

  progressCallback?.({
    percent: Math.min(30, Math.max(20, payloadSegments.length / 2 + 20)),
    stage: `Preparing ${payloadSegments.length} segments for dubbing...`,
    operationId,
    model: ttsProvider,
  });

  progressCallback?.({
    percent: 35,
    stage: `Requesting voice synthesis (0/${payloadSegments.length})...`,
    operationId,
    model: ttsProvider,
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
        model: ttsProvider,
      });

      const result = await synthesizeDubAi({
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

      // Update ttsProvider with actual model from API for better UI feedback
      if (modelUsed) {
        if (modelUsed.includes('eleven')) {
          ttsProvider = 'ElevenLabs TTS';
        } else if (modelUsed.includes('tts-1')) {
          ttsProvider = 'OpenAI TTS';
        }
      }

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
        model: ttsProvider,
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
      model: ttsProvider,
    });

    const preparedSegments: Array<{
      path: string;
      start: number;
      duration: number;
    }> = [];
    const tempSegmentPaths: Set<string> = new Set();
    let fallbackStart = 0;

    const stage5Segments = [...(synthResult.segments ?? [])].sort((a, b) => {
      const ai = Number.isFinite(a?.index)
        ? Number(a.index)
        : Number.MAX_SAFE_INTEGER;
      const bi = Number.isFinite(b?.index)
        ? Number(b.index)
        : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return 0;
    });

    const clipCount = stage5Segments.length;
    for (let clipIdx = 0; clipIdx < clipCount; clipIdx++) {
      const clip = stage5Segments[clipIdx];
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

      let planStart = Number(meta?.start ?? fallbackStart);
      if (!Number.isFinite(planStart)) {
        planStart = fallbackStart;
        if (meta) meta.start = planStart;
      }

      let scheduledDuration = durationForPlan(meta);
      if (scheduledDuration <= 0) {
        const baseline =
          actualDuration && actualDuration > 0.05 ? actualDuration : 0.6;
        if (meta) {
          setPlanDuration(meta, baseline);
          scheduledDuration = durationForPlan(meta);
        } else {
          scheduledDuration = baseline;
        }
      }

      if (meta && typeof meta.start !== 'number') {
        meta.start = planStart;
        setPlanDuration(meta, scheduledDuration);
        scheduledDuration = durationForPlan(meta);
      }

      let effectiveDuration = scheduledDuration;
      if (meta && actualDuration > 0.01) {
        const desiredNoCompression = Math.max(
          effectiveDuration,
          actualDuration
        );
        if (desiredNoCompression > effectiveDuration) {
          const gained = extendSegmentAllocation(
            targetIndex!,
            desiredNoCompression - effectiveDuration
          );
          if (gained > 0) {
            effectiveDuration = durationForPlan(meta);
            planStart = Number(meta?.start ?? planStart);
          }
        }

        const minDuration = actualDuration / MAX_DUB_COMPRESSION_RATIO;
        if (effectiveDuration < minDuration) {
          const gained = extendSegmentAllocation(
            targetIndex!,
            minDuration - effectiveDuration
          );
          if (gained > 0) {
            effectiveDuration = durationForPlan(meta);
            planStart = Number(meta?.start ?? planStart);
          }
        }
      } else if (!meta && actualDuration > 0.01) {
        const minDuration = actualDuration / MAX_DUB_COMPRESSION_RATIO;
        effectiveDuration = Math.max(effectiveDuration, minDuration);
      }

      let scheduledStart = meta ? Number(meta.start ?? planStart) : planStart;
      let scheduledLength = meta ? durationForPlan(meta) : effectiveDuration;

      let compressionRatio =
        scheduledLength > 0 && actualDuration > 0
          ? actualDuration / scheduledLength
          : 1;

      if (compressionRatio > 1 + COMPRESSION_TOLERANCE) {
        const cappedRatio = Math.min(
          compressionRatio,
          MAX_DUB_COMPRESSION_RATIO
        );
        const cappedDuration =
          cappedRatio > 0 ? actualDuration / cappedRatio : scheduledLength;

        if (meta) {
          if (cappedDuration > scheduledLength + 1e-6) {
            const gained = extendSegmentAllocation(
              targetIndex!,
              cappedDuration - scheduledLength
            );
            if (gained > 0) {
              scheduledLength = durationForPlan(meta);
              planStart = Number(meta?.start ?? planStart);
            }
          }
        } else if (cappedDuration > scheduledLength) {
          scheduledLength = cappedDuration;
        }

        compressionRatio =
          scheduledLength > 0 && actualDuration > 0
            ? actualDuration / scheduledLength
            : 1;

        if (compressionRatio > 1 + COMPRESSION_TOLERANCE) {
          const atempoFilters = buildAtempoFilters(compressionRatio);
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
              actualDuration = scheduledLength;
            } catch (stretchErr) {
              log.warn(
                `[${operationId}] Failed to retime segment ${
                  targetIndex ?? 'unknown'
                } (factor=${compressionRatio.toFixed(3)}):`,
                stretchErr
              );
            }
          } else {
            log.warn(
              `[${operationId}] Unable to build atempo filters for ratio ${compressionRatio.toFixed(3)}; leaving audio uncompressed.`
            );
          }
        }
      }

      // Use ORIGINAL start time for proper sync with video, not any modified timing
      const originalStart = targetIndex != null
        ? originalStartByIndex.get(targetIndex) ?? planStart
        : planStart;
      scheduledStart = Math.max(0, originalStart);
      scheduledLength = meta ? durationForPlan(meta) : scheduledLength;

      preparedSegments.push({
        path: finalPath,
        start: scheduledStart,
        duration: scheduledLength,
      });

      fallbackStart = Math.max(fallbackStart, scheduledStart + scheduledLength);

      if (totalClips > 0) {
        const alignPercent =
          45 + Math.min(13, (13 * (clipIdx + 1)) / totalClips);
        progressCallback?.({
          percent: Math.min(58, alignPercent),
          stage: `Aligning voice segments ${clipIdx + 1}/${totalClips}...`,
          operationId,
          model: ttsProvider,
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
        model: ttsProvider,
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
    model: ttsProvider,
  });

  if (!videoPath) {
    progressCallback?.({
      percent: 100,
      stage: 'Dub audio ready',
      operationId,
      model: ttsProvider,
    });
    return { audioPath: processedAudioPath };
  }

  const outputPath = path.join(
    tmpDir,
    `dubbed-${operationId}-${Date.now()}.mp4`
  );

  try {
    const audioStats = await fs.stat(processedAudioPath);
    log.info(
      `[${operationId}] Prepared dub track ${processedAudioPath} (${audioStats.size} bytes)`
    );
    if (audioStats.size < 1024) {
      log.warn(
        `[${operationId}] Dubbed audio is unusually small; verifying synthesis results.`
      );
    }
  } catch (statErr) {
    log.warn(
      `[${operationId}] Unable to stat processed dub audio ${processedAudioPath}:`,
      statErr
    );
  }

  try {
    progressCallback?.({
      percent: 85,
      stage: 'Balancing audio tracks...',
      operationId,
      model: ttsProvider,
    });

    const mixValueRaw = typeof ambientMix === 'number' ? ambientMix : 0.35;
    const mix = Math.min(1, Math.max(0, mixValueRaw));
    const ambientRatio = mix;
    const voiceRatio = 1 - mix;
    const ambientActive = ambientRatio > 0.001;
    const voiceActive = voiceRatio > 0.001;

    const backgroundVolume = ambientActive ? 0.2 + ambientRatio * 0.35 : 0; // 0.20 → 0.55
    const voiceVolume = voiceActive ? 1.25 + voiceRatio * 0.35 : 0; // 1.25 → 1.60

    const ambientWeight = ambientActive
      ? (0.5 + ambientRatio) * ambientRatio
      : 0; // scale down near 0
    const voiceWeight = voiceActive ? 2.0 * voiceRatio : 0; // fade out as slider approaches 100% ambient
    const normalize = ambientActive && voiceActive ? 1 : 0;

    log.info(
      `[${operationId}] Ambient mix value received: ${mixValueRaw} (clamped: ${mix}); weights bg=${ambientWeight.toFixed(3)} voice=${voiceWeight.toFixed(3)}; volumes bg=${backgroundVolume.toFixed(2)} voice=${voiceVolume.toFixed(2)}`
    );

    const filterComplex =
      `[0:a]volume=${backgroundVolume.toFixed(2)}[bg];` +
      `[1:a]volume=${voiceVolume.toFixed(2)}[voice];` +
      `[bg][voice]amix=inputs=2:weights=${ambientWeight.toFixed(3)} ${voiceWeight.toFixed(3)}:dropout_transition=0:normalize=${normalize}[aout]`;

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
        '-c:a',
        'aac',
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
    model: ttsProvider,
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
