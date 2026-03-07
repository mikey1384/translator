export const CHARS_PER_TOKEN = 4;
export const SPOKEN_CHARS_PER_MINUTE = 750;
export const SUMMARY_OUTPUT_TOKEN_RATIO = 0.2;

// Estimated tokens produced per 1 hour of audio transcript.
// These heuristics are reused across credit and BYO estimate surfaces.
export const TRANSLATION_TOKENS_PER_AUDIO_HOUR_PROMPT = 16_000;
export const TRANSLATION_TOKENS_PER_AUDIO_HOUR_COMPLETION = 16_000;
export const SUMMARY_INPUT_TOKENS_PER_AUDIO_HOUR = 11_250;
export const SUMMARY_OUTPUT_TOKENS_PER_AUDIO_HOUR = 2_250;

export const TRANSLATION_REVIEW_OVERHEAD_MULTIPLIER = 1.5;
export const TRANSLATION_QUALITY_MULTIPLIER = 5;
export const SUMMARY_QUALITY_MULTIPLIER = 4;

// Stage5 summary runs multiple model calls per chunk:
// 1) summarizeChunk, 2) mergeIntoRunningSummary, 3) proposeHighlightsForChunk.
export const SUMMARY_PIPELINE_OVERHEAD_MULTIPLIER = 3;

// Typical recommendation search path:
// planner + discovery web search + curator + rerank, with one web-search tool call.
export const VIDEO_SUGGESTION_PROMPT_TOKENS_PER_SEARCH = 12_000;
export const VIDEO_SUGGESTION_COMPLETION_TOKENS_PER_SEARCH = 2_000;
export const VIDEO_SUGGESTION_WEB_SEARCH_CALLS_PER_SEARCH = 1;
