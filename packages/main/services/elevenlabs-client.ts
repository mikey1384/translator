import axios from 'axios';
import FormData from 'form-data';
import log from 'electron-log';
import type { DubSegmentPayload } from '@shared-types/app';
import { createAbortableReadStream } from '../utils/abortable-file-stream.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_TTS_MODEL_ID = 'eleven_v3';
const ELEVENLABS_TTS_MAX_TEXT_CHARACTERS = 5_000;

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
  format?: string;
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

type ElevenLabsDubFormat = 'mp3' | 'opus' | 'pcm' | 'wav';

function resolveElevenLabsDubFormat(format?: string): {
  normalizedFormat: ElevenLabsDubFormat;
  apiOutputFormat: string;
  wrapPcmAsWav?: boolean;
} {
  const normalized = String(format || 'mp3')
    .trim()
    .toLowerCase();
  switch (normalized) {
    case 'mp3':
      return {
        normalizedFormat: 'mp3',
        apiOutputFormat: 'mp3_44100_128',
      };
    case 'opus':
      return {
        normalizedFormat: 'opus',
        apiOutputFormat: 'opus_48000_32',
      };
    case 'pcm':
      return {
        normalizedFormat: 'pcm',
        apiOutputFormat: 'pcm_44100',
      };
    case 'wav':
      return {
        normalizedFormat: 'wav',
        apiOutputFormat: 'pcm_44100',
        wrapPcmAsWav: true,
      };
    default:
      throw new Error(
        `ElevenLabs does not support requested output format "${normalized}"`
      );
  }
}

function usesElevenV3(modelId?: string): boolean {
  return (
    String(modelId || '')
      .trim()
      .toLowerCase() === ELEVENLABS_TTS_MODEL_ID
  );
}

function assertElevenLabsTtsTextLength(text: string): void {
  if (text.length <= ELEVENLABS_TTS_MAX_TEXT_CHARACTERS) {
    return;
  }

  throw new Error(
    `ElevenLabs accepts at most ${ELEVENLABS_TTS_MAX_TEXT_CHARACTERS} characters per segment`
  );
}

function wrapPcm16LeAsWav(
  pcmBuffer: Buffer,
  sampleRate = 44_100,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([wavHeader, pcmBuffer]);
}

export async function transcribeWithElevenLabs({
  filePath,
  apiKey,
  languageCode = 'auto',
  signal,
  idempotencyKey,
}: ElevenLabsTranscribeOptions): Promise<ElevenLabsTranscribeResult> {
  const form = new FormData();
  const { stream, cleanup } = createAbortableReadStream(filePath, signal);
  form.append('file', stream);
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

  try {
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
  } finally {
    cleanup();
  }
}

export async function synthesizeDubWithElevenLabs({
  segments,
  voice = 'adam',
  modelId = ELEVENLABS_TTS_MODEL_ID,
  format = 'mp3',
  apiKey,
  signal,
  concurrency = 3,
}: ElevenLabsDubOptions): Promise<ElevenLabsDubResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No segments provided for dubbing.');
  }

  const voiceId = resolveVoiceId(voice);
  const outputSpec = resolveElevenLabsDubFormat(format);
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

      assertElevenLabsTtsTextLength(text);

      active += 1;
      const requestBody: Record<string, unknown> = {
        text,
        model_id: modelId,
      };

      if (!usesElevenV3(modelId)) {
        requestBody.voice_settings = {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        };
      }

      axios
        .post(
          `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}?output_format=${encodeURIComponent(
            outputSpec.apiOutputFormat
          )}`,
          requestBody,
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
          const audioBuffer = outputSpec.wrapPcmAsWav
            ? wrapPcm16LeAsWav(buffer)
            : buffer;
          out.push({
            index: seg.index ?? out.length,
            audioBase64: audioBuffer.toString('base64'),
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
    format: outputSpec.normalizedFormat,
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
