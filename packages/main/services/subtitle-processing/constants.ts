// --- Configuration Constants ---
export const VAD_NORMALIZATION_MIN_GAP_SEC = 0.5;
export const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.2;
export const PRE_PAD_SEC = 0.1;
export const POST_PAD_SEC = 0.15;
export const MERGE_GAP_SEC = 0.5;
export const MAX_SPEECHLESS_SEC = 15;
export const NO_SPEECH_PROB_THRESHOLD = 0.7;
export const AVG_LOGPROB_THRESHOLD = -4.5;
export const MAX_PROMPT_CHARS = 600;
export const SUBTITLE_GAP_THRESHOLD = 5;
export const MAX_GAP_TO_FUSE = 0.3;

export const MISSING_GAP_SEC = 10;
export const REPAIR_PROGRESS_START = 90;
export const REPAIR_PROGRESS_END = 100;

export const MIN_CHUNK_DURATION_SEC = 8;
export const MAX_CHUNK_DURATION_SEC = 15;
export const GAP_SEC = 3;

// --- Concurrency Setting ---
export const TRANSCRIPTION_BATCH_SIZE = 50;

// --- Review/Polish constants ---
export const REVIEW_BATCH_SIZE = 50;
export const REVIEW_OVERLAP_CTX = 8;
export const REVIEW_STEP = REVIEW_BATCH_SIZE - REVIEW_OVERLAP_CTX;

// Translation and processing progress stages
export const STAGE_AUDIO_EXTRACTION = { start: 0, end: 10 };
export const STAGE_TRANSCRIPTION = { start: 10, end: 50 };
export const STAGE_FINALIZING = { start: 95, end: 100 };

// Progress constants for transcription
export const PROGRESS_ANALYSIS_DONE = 5;
export const PROGRESS_TRANSCRIPTION_START = 20;
export const PROGRESS_TRANSCRIPTION_END = 95;
