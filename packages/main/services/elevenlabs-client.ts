import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import log from 'electron-log';
import type { DubSegmentPayload } from '@shared-types/app';
import { API_TIMEOUTS } from '../../shared/constants/index.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

// Popular ElevenLabs voices for dubbing
export const ELEVENLABS_VOICES = {
  // Premade voices
  rachel: '21m00Tcm4TlvDq8ikWAM', // American, young, calm
  drew: '29vD33N1CtxCmqQRPOHJ', // American, middle-aged, well-rounded
  clyde: '2EiwWnXFnvU5JabPnv8n', // American, middle-aged, war veteran
  paul: '5Q0t7uMcjvnagumLfvZi', // American, middle-aged, ground reporter
  domi: 'AZnzlk1XvdvUeBnXmlld', // American, young, strong
  dave: 'CYw3kZ02Hs0563khs1Fj', // British, young, conversational
  fin: 'D38z5RcWu1voky8WS1ja', // Irish, old, sailor
  sarah: 'EXAVITQu4vr4xnSDxMaL', // American, young, soft
  bella: 'EXAVITQu4vr4xnSDxMaL', // Alias for sarah (same voice)
  antoni: 'ErXwobaYiN019PkySvjV', // American, young, well-rounded
  thomas: 'GBv7mTt0atIp3Br8iCZE', // American, young, calm
  charlie: 'IKne3meq5aSn9XLyUdCD', // Australian, middle-aged, casual
  george: 'JBFqnCBsd6RMkjVDRZzb', // British, middle-aged, warm
  emily: 'LcfcDJNUP1GQjkzn1xUU', // American, young, calm
  elli: 'MF3mGyEYCl7XYWbV9V6O', // American, young, emotional
  callum: 'N2lVS1w4EtoT3dr4eOWO', // Transatlantic, middle-aged, intense
  patrick: 'ODq5zmih8GrVes37Dizd', // American, middle-aged, shouty
  harry: 'SOYHLrjzK2X1ezoPC6cr', // American, young, anxious
  liam: 'TX3LPaxmHKxFdv7VOQHJ', // American, young, articulate
  dorothy: 'ThT5KcBeYPX3keUQqHPh', // British, old, pleasant
  josh: 'TxGEqnHWrfWFTfGW9XjX', // American, young, deep
  arnold: 'VR6AewLTigWG4xSOukaG', // American, middle-aged, crisp
  charlotte: 'XB0fDUnXU5powFXDhCwa', // Swedish, middle-aged, seductive
  matilda: 'XrExE9yKIg1WjnnlVkGX', // American, middle-aged, warm
  brian: 'nPczCjzI2devNBz1zQrb', // American, middle-aged, deep
  matthew: 'Yko7PKs6WkxO6YstNECE', // British, middle-aged, audiobook
  james: 'ZQe5CZNOzWyzPSCn5a3c', // Australian, old, calm
  joseph: 'Zlb1dXrM653N07WRdFW3', // British, middle-aged, ground reporter
  jeremy: 'bVMeCyTHy58xNoL34h3p', // American, old, audiobook
  michael: 'flq6f7yk4E4fJM5XTYuZ', // American, old, orator
  ethan: 'g5CIjZEefAph4nQFvHAz', // American, young, ASMR
  gigi: 'jBpfuIE2acCO8z3wKNLl', // American, young, childish
  freya: 'jsCqWAovK2LkecY7zXl4', // American, young, expressive
  grace: 'oWAxZDx7w5VEj9dCyTzz', // American, young, gentle
  daniel: 'onwK4e9ZLuTAKqWW03F9', // British, middle-aged, deep
  serena: 'pFZP5JQG7iQjIQuC4Bku', // American, middle-aged, pleasant
  adam: 'pNInz6obpgDQGcFmaJgB', // American, middle-aged, deep
  nicole: 'piTKgcLEGmPE4e6mEKli', // American, young, soft
  bill: 'pqHfZKP75CvOlQylNhV4', // American, old, trustworthy
  jessie: 't0jbNlBVZ17f02VDIeMI', // American, old, raspy
  sam: 'yoZ06aMxZJJ28mfd3POQ', // American, young, raspy
  glinda: 'z9fAnlkpzviPz146aGWa', // American, middle-aged, witch
  giovanni: 'zcAOhNBS3c14rBihAFp1', // English-Italian, young
  mimi: 'zrHiDhphv9ZnVXBqCLjz', // Swedish, young, childish
} as const;

export type ElevenLabsVoiceId = keyof typeof ELEVENLABS_VOICES;

export interface ElevenLabsTranscribeOptions {
  filePath: string;
  apiKey: string;
  languageCode?: string; // ISO 639-1 code or 'auto'
  signal?: AbortSignal;
  /** Best-effort idempotency key to avoid duplicate upstream jobs on retry. */
  idempotencyKey?: string;
}

export interface ElevenLabsTranscribeResult {
  text: string;
  language_code: string;
  language_probability: number;
  words?: Array<{
    text: string;
    start: number;
    end: number;
    type: 'word' | 'spacing' | 'audio_event';
    speaker_id?: string;
  }>;
  utterances?: Array<{
    text: string;
    start: number;
    end: number;
    speaker_id?: string;
  }>;
}

export interface ElevenLabsDubOptions {
  segments: Array<
    Pick<
      DubSegmentPayload,
      'index' | 'translation' | 'original' | 'targetDuration'
    >
  >;
  voice?: string; // Voice ID or name
  modelId?: string;
  apiKey: string;
  signal?: AbortSignal;
  concurrency?: number;
}

export interface ElevenLabsDubResult {
  audioBase64?: string;
  format: string;
  voice: string;
  model: string;
  segments?: Array<{
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }>;
}

function resolveVoiceId(voice?: string): string {
  if (!voice) return ELEVENLABS_VOICES.adam;
  // If it's already a voice ID (long string), use it directly
  if (voice.length > 15) return voice;
  // Try to match by name
  const key = voice.toLowerCase() as ElevenLabsVoiceId;
  return ELEVENLABS_VOICES[key] ?? ELEVENLABS_VOICES.adam;
}

export async function transcribeWithElevenLabs({
  filePath,
  apiKey,
  languageCode = 'auto',
  signal,
  idempotencyKey,
}: ElevenLabsTranscribeOptions): Promise<ElevenLabsTranscribeResult> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model_id', 'scribe_v2');
  if (languageCode && languageCode !== 'auto') {
    form.append('language_code', languageCode);
  }
  // Enable all features for detailed transcription
  form.append('tag_audio_events', 'true');
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');

  const headers = {
    ...form.getHeaders(),
    'xi-api-key': apiKey,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };

  const response = await axios.post(
    `${ELEVENLABS_BASE_URL}/speech-to-text`,
    form,
    {
      headers,
      signal,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600_000, // 10 minutes for long audio
    }
  );

  return response.data;
}

export async function synthesizeDubWithElevenLabs({
  segments,
  voice = 'adam',
  modelId = 'eleven_v3',
  apiKey,
  signal,
  concurrency = 3,
}: ElevenLabsDubOptions): Promise<ElevenLabsDubResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No segments provided for dubbing.');
  }

  const voiceId = resolveVoiceId(voice);
  const limiter = Math.max(1, Math.min(5, concurrency));
  const queue = [...segments];
  const out: Array<{
    index: number;
    audioBase64: string;
    targetDuration?: number;
  }> = [];

  let active = 0;
  let error: any = null;

  await new Promise<void>(resolve => {
    const pump = () => {
      if (error) {
        if (active === 0) resolve();
        return;
      }
      if (queue.length === 0) {
        if (active === 0) resolve();
        return;
      }
      if (active >= limiter) {
        return;
      }

      const seg = queue.shift();
      if (!seg) {
        if (active === 0) resolve();
        return;
      }

      const text = (seg.translation || seg.original || '').trim();
      if (!text) {
        out.push({
          index: seg.index ?? out.length,
          audioBase64: '',
          targetDuration: seg.targetDuration,
        });
        pump();
        return;
      }

      active += 1;

      axios
        .post(
          `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
          {
            text,
            model_id: modelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          },
          {
            responseType: 'arraybuffer',
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            signal,
          }
        )
        .then(res => {
          const buffer = Buffer.from(res.data as ArrayBuffer);
          out.push({
            index: seg.index ?? out.length,
            audioBase64: buffer.toString('base64'),
            targetDuration: seg.targetDuration,
          });
        })
        .catch(err => {
          error = err;
          log.error(
            '[elevenlabs-client] TTS synthesis failed:',
            err?.message || err
          );
        })
        .finally(() => {
          active -= 1;
          pump();
        });

      pump();
    };

    for (let i = 0; i < limiter; i++) {
      pump();
    }
  });

  if (error) {
    throw error;
  }

  out.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return {
    format: 'mp3',
    voice: voiceId,
    model: modelId,
    segments: out,
  };
}

export async function testElevenLabsApiKey(
  apiKey: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    // Test by fetching user info
    await axios.get(`${ELEVENLABS_BASE_URL}/user`, {
      headers: {
        'xi-api-key': apiKey,
      },
      signal,
      timeout: 10_000,
    });
    return true;
  } catch (err: any) {
    log.warn(
      '[elevenlabs-client] API key validation failed:',
      err?.message || err
    );
    throw err;
  }
}

export async function getElevenLabsVoices(
  apiKey: string,
  signal?: AbortSignal
): Promise<Array<{ voice_id: string; name: string; category: string }>> {
  try {
    const response = await axios.get(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: {
        'xi-api-key': apiKey,
      },
      signal,
      timeout: 15_000,
    });
    return response.data?.voices ?? [];
  } catch (err: any) {
    log.warn(
      '[elevenlabs-client] Failed to fetch voices:',
      err?.message || err
    );
    return [];
  }
}

// ============================================================================
// ElevenLabs Dubbing API - Full video/audio dubbing with voice cloning
// ============================================================================

export interface ElevenLabsDubbingJobOptions {
  filePath: string; // Path to video/audio file
  sourceLanguage?: string; // ISO 639-1 code (auto-detect if not provided)
  targetLanguage: string; // ISO 639-1 code
  apiKey: string;
  numSpeakers?: number; // 0 = auto-detect (max 9 recommended)
  dropBackgroundAudio?: boolean; // Remove background audio for cleaner dub
  signal?: AbortSignal;
  onProgress?: (status: string, percent?: number) => void;
}

export interface ElevenLabsDubbingResult {
  dubbingId: string;
  audioBase64: string;
  format: string;
  transcript?: string; // SRT format
  targetLanguage: string;
}

/**
 * Submit a dubbing job to ElevenLabs
 */
export async function submitDubbingJob({
  filePath,
  sourceLanguage,
  targetLanguage,
  apiKey,
  numSpeakers = 0,
  dropBackgroundAudio = false,
  signal,
}: Omit<ElevenLabsDubbingJobOptions, 'onProgress'>): Promise<{
  dubbingId: string;
  expectedDurationSec: number;
}> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('target_lang', targetLanguage);

  if (sourceLanguage) {
    form.append('source_lang', sourceLanguage);
  }
  if (numSpeakers > 0) {
    form.append('num_speakers', String(numSpeakers));
  }
  if (dropBackgroundAudio) {
    form.append('drop_background_audio', 'true');
  }

  const response = await axios.post(`${ELEVENLABS_BASE_URL}/dubbing`, form, {
    headers: {
      ...form.getHeaders(),
      'xi-api-key': apiKey,
    },
    signal,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120_000, // 2 minutes for upload
  });

  return {
    dubbingId: response.data.dubbing_id,
    expectedDurationSec: response.data.expected_duration_sec ?? 60,
  };
}

/**
 * Poll dubbing job status
 */
export async function getDubbingStatus(
  dubbingId: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{
  status: 'dubbing' | 'dubbed' | 'failed' | 'cloning';
  error?: string;
}> {
  const response = await axios.get(
    `${ELEVENLABS_BASE_URL}/dubbing/${dubbingId}`,
    {
      headers: { 'xi-api-key': apiKey },
      signal,
      timeout: 30_000,
    }
  );

  return {
    status: response.data.status,
    error: response.data.error,
  };
}

/**
 * Get dubbed audio as base64
 */
export async function getDubbedAudio(
  dubbingId: string,
  languageCode: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ audioBase64: string; format: string }> {
  const response = await axios.get(
    `${ELEVENLABS_BASE_URL}/dubbing/${dubbingId}/audio/${languageCode}`,
    {
      headers: { 'xi-api-key': apiKey },
      responseType: 'arraybuffer',
      signal,
      timeout: 300_000, // 5 minutes for large files
    }
  );

  const buffer = Buffer.from(response.data as ArrayBuffer);
  return {
    audioBase64: buffer.toString('base64'),
    format: 'mp3',
  };
}

/**
 * Get dubbed transcript as SRT
 */
export async function getDubbedTranscript(
  dubbingId: string,
  languageCode: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await axios.get(
    `${ELEVENLABS_BASE_URL}/dubbing/${dubbingId}/transcript/${languageCode}`,
    {
      headers: { 'xi-api-key': apiKey },
      params: { format_type: 'srt' },
      signal,
      timeout: 30_000,
    }
  );

  return response.data;
}

/**
 * Full dubbing workflow: submit, poll, and retrieve results
 */
export async function dubWithElevenLabs({
  filePath,
  sourceLanguage,
  targetLanguage,
  apiKey,
  numSpeakers = 0,
  dropBackgroundAudio = false,
  signal,
  onProgress,
}: ElevenLabsDubbingJobOptions): Promise<ElevenLabsDubbingResult> {
  // Step 1: Submit dubbing job
  onProgress?.('Uploading to ElevenLabs...', 5);
  log.info(
    `[elevenlabs-client] Submitting dubbing job for ${filePath} -> ${targetLanguage}`
  );

  const { dubbingId, expectedDurationSec } = await submitDubbingJob({
    filePath,
    sourceLanguage,
    targetLanguage,
    apiKey,
    numSpeakers,
    dropBackgroundAudio,
    signal,
  });

  log.info(
    `[elevenlabs-client] Dubbing job submitted: ${dubbingId}, expected ${expectedDurationSec}s`
  );
  onProgress?.('Processing audio...', 10);

  // Step 2: Poll for completion
  const pollInterval = API_TIMEOUTS.VOICE_CLONING_POLL_INTERVAL;
  const maxWait = Math.max(
    API_TIMEOUTS.VOICE_CLONING_BASE_MAX_WAIT,
    expectedDurationSec * 3000
  ); // At least 10 min or 3x expected
  const startTime = Date.now();
  let lastStatus: string = 'dubbing';

  while (Date.now() - startTime < maxWait) {
    if (signal?.aborted) {
      throw new Error('Dubbing cancelled');
    }

    const { status, error } = await getDubbingStatus(dubbingId, apiKey, signal);

    if (status === 'failed') {
      throw new Error(`Dubbing failed: ${error || 'Unknown error'}`);
    }

    if (status === 'dubbed') {
      log.info(`[elevenlabs-client] Dubbing complete for ${dubbingId}`);
      break;
    }

    // Update progress with status-aware messages
    const elapsed = Date.now() - startTime;
    const baseProgress = 10 + (elapsed / (expectedDurationSec * 1000)) * 70;
    const progress = Math.min(80, baseProgress);

    // Show different messages based on actual API status
    let statusMessage: string;
    if (status === 'cloning') {
      statusMessage = 'Cloning voice...';
    } else if (elapsed < 10000) {
      statusMessage = 'Analyzing audio...';
    } else if (elapsed < 30000) {
      statusMessage = 'Detecting speakers...';
    } else {
      statusMessage = 'Generating dubbed audio...';
    }

    if (status !== lastStatus) {
      log.info(`[elevenlabs-client] Dubbing status: ${status}`);
      lastStatus = status;
    }

    onProgress?.(statusMessage, Math.round(progress));

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // If we exited due to timeout (not break), throw error
  const finalElapsed = Date.now() - startTime;
  if (finalElapsed >= maxWait) {
    throw new Error(
      `Dubbing timed out after ${Math.round(finalElapsed / 1000)}s`
    );
  }

  // Step 3: Retrieve dubbed audio and transcript
  onProgress?.('Downloading dubbed audio...', 90);

  const [audioResult, transcript] = await Promise.all([
    getDubbedAudio(dubbingId, targetLanguage, apiKey, signal),
    getDubbedTranscript(dubbingId, targetLanguage, apiKey, signal).catch(
      err => {
        log.warn(
          `[elevenlabs-client] Failed to get transcript: ${err?.message}`
        );
        return undefined;
      }
    ),
  ]);

  onProgress?.('Complete', 100);

  return {
    dubbingId,
    audioBase64: audioResult.audioBase64,
    format: audioResult.format,
    transcript,
    targetLanguage,
  };
}
