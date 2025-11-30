// --- Configuration Constants ---
export const SAVE_WHISPER_CHUNKS = false;
export const VAD_NORMALIZATION_MIN_GAP_SEC = 0.5;
export const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.2;
export const PRE_PAD_SEC = 0.3;
export const POST_PAD_SEC = 0.0;
export const MERGE_GAP_SEC = 0.5;
export const MAX_SPEECHLESS_SEC = 15;
export const NO_SPEECH_PROB_THRESHOLD = 0.7;
export const MAX_PROMPT_CHARS = 600;

// --- Gaps ---
export const GAP_SEC = 3;

// --- Chunking constants ---
export const MIN_CHUNK_DURATION_SEC = 3;
export const MAX_CHUNK_DURATION_SEC = 15;

// --- Concurrency Setting ---
export const TRANSCRIPTION_BATCH_SIZE = 5;

// --- Review/Polish constants ---
export const REVIEW_BATCH_SIZE = 50;
export const REVIEW_OVERLAP_CTX = 8;
export const REVIEW_STEP = REVIEW_BATCH_SIZE - REVIEW_OVERLAP_CTX;

// Progress constants for transcription
export const PROGRESS_ANALYSIS_DONE = 5;

// --- Readability / Segmentation constraints (applied using Whisper word timings)
// Aim: keep cues readable without deviating far from Whisper output.
export const MAX_FINAL_SEGMENT_DURATION_SEC = 6.0; // hard limit per cue
export const TARGET_FINAL_SEGMENT_DURATION_SEC = 4.0; // preferred split point
export const MIN_FINAL_SEGMENT_DURATION_SEC = 1.2; // avoid overly tiny cues
export const SPLIT_AT_PAUSE_GAP_SEC = 0.35; // prefer splits on natural pauses

// --- Text density constraints for NORMAL videos (landscape/widescreen)
// More relaxed limits for traditional video content
export const MAX_CHARS_PER_SEGMENT = 120; // ~3 lines readable
export const TARGET_CHARS_PER_SEGMENT = 84; // 2 lines × 42 chars
export const MAX_WORDS_PER_SEGMENT = 20; // comfortable reading
export const TARGET_WORDS_PER_SEGMENT = 14; // preferred split point for words
export const MAX_CHARS_PER_SECOND = 25; // reading speed limit

// --- Text density constraints for SHORTS (portrait/vertical 9:16)
// Aggressive limits for TikTok/Reels/Shorts style content
export const SHORTS_MAX_CHARS_PER_SEGMENT = 60; // 1-2 short lines
export const SHORTS_TARGET_CHARS_PER_SEGMENT = 42; // ~1 line
export const SHORTS_MAX_WORDS_PER_SEGMENT = 10; // very punchy
export const SHORTS_TARGET_WORDS_PER_SEGMENT = 6; // few words per segment
export const SHORTS_MAX_CHARS_PER_SECOND = 18; // slower reading for mobile
export const SHORTS_MAX_DURATION_SEC = 3.0; // shorter segments for shorts
export const SHORTS_TARGET_DURATION_SEC = 2.0; // even shorter preferred

// Short-form video detection threshold (width/height ratio)
export const SHORTS_RATIO_CUTOFF = 0.68; // ~9:16 portrait or taller

// --- ASR Output Format Configuration ---
import {
  ASR_USE_FLAC,
  ASR_FAST_MODE,
} from '../../../shared/constants/runtime-config.js';

const USE_FLAC = ASR_USE_FLAC;
const fastMode = ASR_FAST_MODE;

// --- Whisper-optimized settings (low quality, fast) ---
export const ASR_SAMPLE_RATE = fastMode ? 12_000 : 16_000;
export const ASR_SAMPLE_FMT = 's16';
export const ASR_OUT_EXT = USE_FLAC ? '.flac' : '.webm';
export const ASR_AUDIO_CODEC = USE_FLAC ? 'flac' : 'libopus';
export const ASR_OPUS_BITRATE = fastMode ? '24k' : '32k';
export const ASR_VBR = 'on';
export const ASR_COMPR_LEVEL = fastMode ? 6 : 8;

// --- ElevenLabs-optimized settings (high quality, no chunking) ---
// ElevenLabs Scribe benefits from higher quality audio and speaker diarization
// which requires the full audio file (no chunking)
export const ELEVENLABS_SAMPLE_RATE = 16_000; // 16kHz for better quality
export const ELEVENLABS_OPUS_BITRATE = '64k'; // Higher bitrate for clarity
export const ELEVENLABS_COMPR_LEVEL = 10; // Best FLAC compression
