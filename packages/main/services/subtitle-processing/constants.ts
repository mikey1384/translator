// --- Configuration Constants ---
export const SAVE_WHISPER_CHUNKS = false;
export const VAD_NORMALIZATION_MIN_GAP_SEC = 0.5;
export const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.2;
export const PRE_PAD_SEC = 0.1;
export const POST_PAD_SEC = 0.15;
export const MERGE_GAP_SEC = 0.5;
export const MAX_SPEECHLESS_SEC = 15;
export const NO_SPEECH_PROB_THRESHOLD = 0.96;
export const LOG_PROB_THRESHOLD = -6.5;
export const MAX_PROMPT_CHARS = 600;
export const MIN_DURATION_FOR_RETRY_SPLIT_SEC = 5.0;
export const MIN_HALF_DURATION_FACTOR = 0.8;
export const SUBTITLE_GAP_THRESHOLD = 5;

// --- Gaps ---
export const MAX_GAP_TO_FUSE = 0.3;
export const GAP_SEC = 3;

// --- Chunking constants ---
export const MIN_CHUNK_DURATION_SEC = 8;
export const MAX_CHUNK_DURATION_SEC = 15;

// --- Concurrency Setting ---
export const TRANSCRIPTION_BATCH_SIZE = 30;

// --- Review/Polish constants ---
export const REVIEW_BATCH_SIZE = 50;
export const REVIEW_OVERLAP_CTX = 8;
export const REVIEW_STEP = REVIEW_BATCH_SIZE - REVIEW_OVERLAP_CTX;

// Progress constants for transcription
export const PROGRESS_ANALYSIS_DONE = 5;
